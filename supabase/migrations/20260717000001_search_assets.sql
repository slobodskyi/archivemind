-- Search (spec §8.4, issue #15): cosine similarity over embeddings with
-- metadata filters, exposed as one RPC for GET /api/search.
--
-- SECURITY INVOKER on purpose: RLS on embeddings/assets/asset_exif/asset_tags
-- already scopes every row to the caller's memberships — the ws/proj params
-- narrow *within* that, they are not the security boundary. Ranking: cosine
-- distance minus a small boost per matched tag term (matched tags come back
-- so the UI can explain *why* something matched).

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
    select array_agg(t.name) as tags
    from asset_tags at2
    join tags t on t.id = at2.tag_id
    where at2.asset_id = a.id
      and tag_terms is not null
      and t.name = any (tag_terms)
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
  order by (e.embedding <=> query_embedding) - 0.03 * coalesce(array_length(mt.tags, 1), 0) asc
  limit greatest(1, least(match_limit, 100))
$$;

-- The web route logs a usage_events row per search (spec §8.4). Until now only
-- the worker (service role, RLS-exempt) wrote usage_events — members need an
-- INSERT path; reads stay workspace-scoped via the existing select policy.
create policy usage_events_insert on usage_events
  for insert with check (is_member(workspace_id));
