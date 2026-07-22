# 0029. Search results split into relevance tiers; tag matches outrank cosine

Date: 2026-07-22

Status: Accepted

Refines the search shipped under [issue #15]/[#16] (spec §8.4, migration
`20260717000001`). The query-parse → embed → `search_assets()` pipeline is
unchanged; what changes is how the ranked list is cut, ordered, and presented.

## Context

`search_assets()` v1 was a pure ranked list: cosine distance over every
embedded asset in the workspace, `LIMIT 24`, no cutoff of any kind. Tag terms
parsed out of the query were only a −0.03 rank nudge, matched by exact string
equality. Three failure modes followed, all visible on the first real archive:

- **Every query returned the whole archive.** Cosine between any text and any
  image is always *some* number, so an 11-photo archive answered both "dog"
  and "girl" with the same 11 photos, reordered. On a large archive the same
  disease returns exactly 24 rows for anything. Ranking was actually decent
  (the dog photos did rank first) — but "Found 11" for every query reads as
  broken and destroys trust in the results that *are* right.
- **The UI called the tag terms "filters"** while the SQL never filtered on
  them, and exact-equality matching meant "girl" could not meet a `woman`
  tag, nor "retriever" a `golden retriever`.
- **The one signal that separates a hit from noise — `similarity` — was
  discarded client-side**, and matched tags surfaced only in a hover tooltip
  (invisible on touch).

An absolute similarity threshold is the textbook fix and was deliberately
rejected: cross-modal cosine bands are narrow, corpus-dependent, and shift
with model revisions, so any constant tuned today lies after the next
re-embed. A relative cut self-scales.

## Decision

**SQL (migration `20260722000002`, same signature):**

- Tag matching is exact name **or** whole-word of a multi-word tag
  ("retriever" matches `golden retriever`). Word-level, not substring — "cat"
  must not match "education" — and no regex, so model-supplied terms cannot
  inject pattern syntax.
- Tag-matched rows order **above** all cosine-only rows: the user literally
  named them, and on large archives this guarantees they survive the LIMIT
  cut. Cosine (with the small per-tag boost) breaks ties within each block.

**Route (`apps/web/lib/search-tiers.ts`):** every result is annotated
`tier: "strong" | "weak"`, part of the shared zod contract:

- matched an explicit query term (tag or place) → always **strong**;
- otherwise strong only within `STRONG_DELTA` (0.03) of the set's best
  similarity, capped at `STRONG_COSINE_CAP` (6) rows so the flat similarity
  distributions one-word queries produce cannot promote everything.
- Both knobs are code constants, tuned by PR once a real dirty corpus exists
  (#33) — not env vars.

**Parse prompt:** `tag_terms` now asks for 1–2 synonyms/near-variants per
concept (max 6 terms), closing the "girl"-vs-`woman` gap at the vocabulary
level rather than with fuzzy SQL.

**Chat panel:** strong results render as the answer ("3 best matches"); weak
ones collapse behind "Show N more distant" and render dimmed. "Select on
canvas" targets the strong set (select-all appears only once weak results are
shown). The filter note names only what actually filtered or matched —
dates/places always, tags only when ≥1 result carries them. Term-matched
thumbs wear an accent border, so "why it matched" survives touch screens.

## Consequences

- A query now has an honest answer size. Top-1 is always shown (it is
  trivially within δ of itself) — a garbage query still shows its nearest
  neighbours rather than an empty state, which suits an archive-exploration
  tool; the δ-gap and cap keep it to a handful.
- Tag-priority ordering means a photo tagged `dog` beats a visually-similar
  untagged one for the query "dog". That is the desired semantics of naming a
  thing, but it makes tag quality (analyze output) directly user-visible.
- The word-of-multi-word rule widens recall slightly on compound tags; the
  synonym expansion widens it further and costs nothing at query time (the
  parse call already ran). Neither can inject SQL patterns.
- `searchResultSchema` gained a required `tier` — the route is the only
  producer, so no migration concerns, but any future consumer must carry it.
- The tuning constants are guesses until #33 lands a real corpus; they are
  isolated in one file with unit tests precisely so retuning is a one-line PR.
