# 0031. Search goes hybrid: lexical over description/facts + EXIF filters

Date: 2026-07-22

Status: Accepted

Builds on [0029](0029-search-relevance-tiers.md) (relevance tiers, tag-first
ranking). The pipeline (parse → embed → `search_assets()`) and the tier split
are unchanged; this adds two new match paths.

## Context

After 0029, search ranked by image-embedding cosine with tag/place matches
promoted to a strong front block. Two gaps remained, both surfaced by a real
archive:

- **The embedding is of the pixels — it cannot read text inside a photo.** This
  archive is roughly half screenshots (chat logs, notes, posts). The AI
  `description` (stored in `embeddings.content`) and the suggested `facts.text`
  already capture that on-image text, but nothing searched them. A query for a
  word visible in a screenshot matched only by lucky visual similarity.
- **EXIF camera/ISO/aperture were dead weight for search.** `asset_exif` stores
  and the drawer shows camera make/model, lens, ISO, aperture, shutter — but no
  query could reach them. "shot on iPhone 13 Pro", "wide open at f/1.5",
  "high-ISO night frames" had nowhere to go; the parser had no fields for them.

A prior note claimed "the worker already stores OCR text." It does not — the
analyze handler parses `ocr_text` off the model output and discards it
([apps/worker/src/handlers/analyze.ts](../../apps/worker/src/handlers/analyze.ts)
writes only tags, facts, and `description`). The searchable on-image text we
*do* have is the vision model's description, which for a screenshot transcribes
most visible text anyway.

## Decision

`search_assets` v3 (migration `20260722000004`), same shape as the existing
date/place filters:

- **Lexical signal.** `websearch_to_tsquery('simple', text_query)` matched
  against `to_tsvector('simple', embeddings.content)` **and** each asset's
  `facts.text`. The `'simple'` config needs no extension and does no stemming —
  correct for the mixed uk/en corpus. `text_query` is the same string we embed
  (`semantic_text`), so no new parse field. A lexical hit is an **explicit
  match**: it joins tag/place in the strong front block, gets a small extra rank
  boost, and returns as `matched_text` so `lib/search-tiers.ts` marks the tier
  and the chat panel gives the thumb an accent border + "in description" note.
  A GIN index on `to_tsvector('simple', coalesce(content,''))` backs the scan.
- **EXIF filters** (narrow, do not rank): `camera_terms` ILIKE over
  make/model/lens, `iso_min`/`iso_max` range, `aperture_term` ILIKE. A row
  missing the field fails the null comparison and drops — the intended
  semantics. New parse fields (`camera_terms`, `iso_min`, `iso_max`, `aperture`)
  carry them; the prompt maps vague phrasing ("high ISO"/"night" → `iso_min
  1600`, "wide open" → an f-number) only when implied.

The return type gains `matched_text`, so the function is **dropped and
recreated** (create-or-replace can't change `RETURNS TABLE`). The route is the
only caller and pgTAP calls positionally with the new params appended as
defaults, so both survive. All matching is on parameter *values*
(`ILIKE '%'||p||'%'`, `websearch_to_tsquery(p)`) — never string-built SQL — so
terms can't inject.

## Consequences

- Screenshot-heavy archives become searchable by their on-image text via the
  description/facts, with **zero backfill** — both are already populated for
  every analyzed asset. This was the single biggest relevance gap.
- Raw OCR is still discarded. Persisting it (a worker change + a column + a
  re-analyze to populate existing assets) is a deliberate fast-follow, not in
  this PR — the description covers most of the value now without a re-analyze.
- EXIF queries work but are only as good as the stored EXIF: phone photos carry
  rich EXIF, exported/edited files often carry none and silently won't match an
  EXIF filter. The chat note names the applied filters so an empty result is
  legible.
- The facts lexical path is an unindexed `EXISTS` per candidate row; fine at
  MVP scale (few facts per asset, the outer query is already filtered), a known
  scaling watch-item.
- `searchResultSchema`/`searchParseSchema` grew required/known fields; the route
  is the only producer and every field is `.catch()`-guarded, so a sloppy model
  parse still degrades to plain semantic search rather than 500ing.
