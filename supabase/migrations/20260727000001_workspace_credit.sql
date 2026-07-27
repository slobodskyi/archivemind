-- Workspace-level credit / rights block, for exported deliverables.
--
-- An editorial deliverable without a byline is not a cosmetic gap: it is why a
-- file runs uncredited or gets rejected outright. `grep -rEn
-- 'copyright|credit|byline|artist|photographer' supabase/migrations/*.sql`
-- returned nothing before this — the schema had no notion of who made the work.
--
-- Workspace level, not per-asset: the product's user is a documentary
-- photographer whose whole archive carries one byline (TECH_SPEC §1). A per-asset
-- override is the right follow-up for mixed-provenance archives and is roughly
-- double the work; nothing here forecloses it.
--
-- Raw EXIF is only a partial escape hatch and not a substitute: services/exif.ts
-- calls exifr with { gps: true } and does not enable iptc/xmp, so IFD0
-- Artist/Copyright reach asset_exif.raw for JPEGs while IPTC Credit / By-line
-- never do at all.
--
-- No RLS change is needed. `workspaces_select` is is_member(id) (as amended by
-- 20260710000002) and `workspaces_update` is is_owner(id) with no column
-- restriction, so an owner can already write these and every member can read
-- them. The worker reads through the service-role pool, outside RLS.

alter table workspaces
  add column creator text,            -- "Oleksandr Slobodskyi"
  add column credit text,             -- credit line as it must appear, e.g. "Photo: O. Slobodskyi / ArchiveMind"
  add column copyright_notice text,   -- "© 2026 Oleksandr Slobodskyi. All rights reserved."
  add column usage_terms text;        -- "Editorial use only. No resale."

comment on column workspaces.credit is
  'Credit line printed on exported deliverables (ADR 0035 amendments). Workspace-level default; a per-asset override is a future addition.';
