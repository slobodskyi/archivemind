-- Search relevance, round 3 (ADR 0031): hybrid lexical + EXIF.
--
-- v2 (20260722000002) ranked by image-embedding cosine with tag/place matches
-- promoted to the front. Two blind spots remained:
--
-- 1. The embedding is of the PIXELS. It cannot read text *inside* a photo — and
--    this archive is half screenshots. The AI `description` (embeddings.content)
--    and suggested `facts.text` are already stored and hold that text, but v2
--    never searched them.
-- 2. EXIF camera/ISO/aperture are stored (asset_exif) and shown in the drawer,
--    but no query could reach them ("shot on iPhone 13 Pro", "wide open at f/1.5",
--    "high-ISO night frames").
--
-- v3 adds, same idea as the existing date/place filters:
--   - a lexical signal: websearch_to_tsquery over description + facts using the
--     'simple' config (no stemming, language-agnostic — the corpus is uk/en
--     mixed, and 'simple' needs no extension). A lexical hit joins tag/place as
--     an EXPLICIT match: it lands in the front block and reads as "strong" in the
--     UI, with a small extra rank boost. Returned as `matched_text` so the route's
--     tier logic (lib/search-tiers.ts) can mark it.
--   - EXIF FILTERS (narrowing, not ranking): camera make/model/lens ILIKE, ISO
--     range, aperture ILIKE. An asset missing the field simply fails the filter.
--
-- Raw OCR is deliberately NOT sourced here — the worker discards ocr_text today
-- (see ADR 0031 Consequences); the description already carries most screenshot
-- text, and raw-OCR persistence is a separate change that needs a re-analyze.
--
-- The return type gains a column, so this must DROP + recreate (create-or-replace
-- cannot change RETURNS TABLE). The route is the only caller; pgTAP calls it
-- positionally and the new params are appended with defaults, so both keep working.
-- SECURITY INVOKER rationale unchanged from v1: RLS is the boundary, the params
-- only narrow within it. All matching uses parameter *values* (ILIKE '%'||p||'%',
-- websearch_to_tsquery(p)) — never string-built SQL, so terms can't inject.

drop function if exists public.search_assets(
  vector, uuid, uuid, timestamptz, timestamptz, text[], text[], int);

-- Index the lexical corpus. to_tsvector('simple', const) is immutable, so it is
-- indexable; coalesce guards the null descriptions of not-yet-analyzed rows.
create index if not exists embeddings_content_fts_idx
  on embeddings using gin (to_tsvector('simple', coalesce(content, '')));

create function public.search_assets(
  query_embedding vector(768),
  ws uuid,
  proj uuid default null,
  date_from timestamptz default null,
  date_to timestamptz default null,
  place_terms text[] default null,
  tag_terms text[] default null,
  match_limit int default 24,
  text_query text default null,
  camera_terms text[] default null,
  iso_min int default null,
  iso_max int default null,
  aperture_term text default null
) returns table (
  asset_id uuid,
  similarity real,
  matched_tags text[],
  matched_place text,
  matched_text boolean,
  taken_at timestamptz
)
language sql stable
set search_path = public
as $$
  with tq as (
    select case
      when text_query is null or length(btrim(text_query)) = 0 then null
      else websearch_to_tsquery('simple', text_query)
    end as q
  )
  select
    a.id as asset_id,
    (1 - (e.embedding <=> query_embedding))::real as similarity,
    coalesce(mt.tags, '{}') as matched_tags,
    case
      when place_terms is not null and ex.gps_label is not null and exists (
        select 1 from unnest(place_terms) pt where ex.gps_label ilike '%' || pt || '%')
      then ex.gps_label
    end as matched_place,
    coalesce(lx.hit, false) as matched_text,
    ex.taken_at
  from embeddings e
  join assets a on a.id = e.asset_id and a.status = 'active'
  left join asset_exif ex on ex.asset_id = a.id
  cross join tq
  left join lateral (
    select array_agg(distinct t.name order by t.name) as tags
    from asset_tags at2
    join tags t on t.id = at2.tag_id
    where at2.asset_id = a.id
      and tag_terms is not null
      and exists (
        select 1 from unnest(tag_terms) tt
        where t.name = tt or tt = any(string_to_array(t.name, ' ')))
  ) mt on true
  left join lateral (
    -- Lexical hit over the AI description + suggested facts. Computed once here,
    -- reused in the select and the order by.
    select (
      tq.q is not null and (
        to_tsvector('simple', coalesce(e.content, '')) @@ tq.q
        or exists (
          select 1 from facts f
          where f.asset_id = a.id
            and to_tsvector('simple', f.text) @@ tq.q)
      )
    ) as hit
  ) lx on true
  where e.workspace_id = ws
    and e.kind = 'image'
    and (proj is null or exists (
      select 1 from project_assets pa where pa.asset_id = a.id and pa.project_id = proj))
    and (date_from is null or ex.taken_at >= date_from)
    and (date_to   is null or ex.taken_at <= date_to)
    -- Places: GPS label match, else a place-category tag (spec §8.4's no-GPS
    -- fallback — pro cameras often carry no GPS at all).
    and (place_terms is null
      or (ex.gps_label is not null and exists (
        select 1 from unnest(place_terms) pt where ex.gps_label ilike '%' || pt || '%'))
      or exists (
        select 1
        from asset_tags at3
        join tags t3 on t3.id = at3.tag_id
        where at3.asset_id = a.id and t3.category = 'place'
          and exists (select 1 from unnest(place_terms) pt where t3.name ilike '%' || pt || '%')))
    -- EXIF filters (narrow the set; do not affect ranking). A row missing the
    -- field is null-compared and therefore excluded, which is the intent.
    and (camera_terms is null or exists (
      select 1 from unnest(camera_terms) ct
      where coalesce(ex.camera_make, '')  ilike '%' || ct || '%'
         or coalesce(ex.camera_model, '') ilike '%' || ct || '%'
         or coalesce(ex.lens, '')         ilike '%' || ct || '%'))
    and (iso_min is null or ex.iso >= iso_min)
    and (iso_max is null or ex.iso <= iso_max)
    and (aperture_term is null or coalesce(ex.aperture, '') ilike '%' || aperture_term || '%')
  order by
    -- Explicit-match block first: a tag OR a lexical hit (place is already
    -- surfaced via matched_place and rides the cosine tie-break).
    (mt.tags is null and not coalesce(lx.hit, false)) asc,
    (e.embedding <=> query_embedding)
      - 0.03 * coalesce(array_length(mt.tags, 1), 0)
      - (case when coalesce(lx.hit, false) then 0.05 else 0 end) asc
  limit greatest(1, least(match_limit, 100))
$$;
