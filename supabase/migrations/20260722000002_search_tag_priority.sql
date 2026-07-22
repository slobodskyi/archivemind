-- Search relevance, round 2 (ADR 0029): make tag matches mean something.
--
-- The v1 function (20260717000001) treated tag_terms as a -0.03 rank nudge on
-- an otherwise pure cosine ordering, and matched tags only by exact equality.
-- On a small corpus every query returned the whole archive reordered; a photo
-- literally tagged "dog" had no guaranteed edge over cosine noise, and "dog"
-- never matched the tag "golden retriever". Two changes, same signature:
--
-- 1. Tag matching: exact name OR the term equals one whole word of a
--    multi-word tag ("retriever" matches "golden retriever"). Word-level, not
--    substring — "cat" must not match "education". No regex, so model-supplied
--    terms can't inject pattern syntax.
-- 2. Ordering: tag-matched rows rank above all cosine-only rows (they carry
--    an explicit user term — on large archives this also guarantees they
--    survive the LIMIT cut), cosine + the small per-tag boost breaking ties
--    within each block.
--
-- The strong/weak split shown in the UI happens in the web route
-- (apps/web/lib/search-tiers.ts) over these rows — the function stays a pure
-- ranked list. SECURITY INVOKER rationale unchanged from v1: RLS is the
-- boundary, ws/proj only narrow within it.

create or replace function public.search_assets(
  query_embedding vector(768),
  ws uuid,
  proj uuid default null,
  date_from timestamptz default null,
  date_to timestamptz default null,
  place_terms text[] default null,
  tag_terms text[] default null,
  match_limit int default 24
) returns table (
  asset_id uuid,
  similarity real,
  matched_tags text[],
  matched_place text,
  taken_at timestamptz
)
language sql stable
set search_path = public
as $$
  select
    a.id as asset_id,
    (1 - (e.embedding <=> query_embedding))::real as similarity,
    coalesce(mt.tags, '{}') as matched_tags,
    case
      when place_terms is not null and ex.gps_label is not null and exists (
        select 1 from unnest(place_terms) pt where ex.gps_label ilike '%' || pt || '%')
      then ex.gps_label
    end as matched_place,
    ex.taken_at
  from embeddings e
  join assets a on a.id = e.asset_id and a.status = 'active'
  left join asset_exif ex on ex.asset_id = a.id
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
  order by
    (mt.tags is null) asc,  -- tag-matched block first (false sorts before true)
    (e.embedding <=> query_embedding) - 0.03 * coalesce(array_length(mt.tags, 1), 0) asc
  limit greatest(1, least(match_limit, 100))
$$;
