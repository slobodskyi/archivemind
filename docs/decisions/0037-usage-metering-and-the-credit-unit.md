# 0037 — Usage metering, and what a credit is

Status: **Accepted** (2026-07-27)

## Context

The account menus have carried three entries since the mockup — Account
Settings, Billing & Plan, Usage & Storage — and all three toasted "coming
soon". Building the third one forced a question the spec had deferred:
TECH_SPEC rule 11 says every AI action is logged in `usage_events` "for the
future credits model", and §13 puts *billing & credit enforcement* out of MVP
("tracking only"). Nowhere does anything say **what a credit is**, and the
tracking turned out to be half-built:

- `asset_previews` and `asset_edits` stored only R2 keys; the export job stored
  only `payload.result_key`. Of the four things we hold bytes for, exactly one —
  originals, via `files.byte_size` — was measurable. A storage meter built on
  that schema could show one honest number and would have had to invent four.
- `ingest` wrote no `usage_event` at all, so storage growth was not attributable
  over time even though every AI action was.
- `usage_events.cost_usd` and `ai_jobs.cost_usd` have existed since migration
  0001 and were written by nobody.

A usage page is the first surface where these gaps become *visible wrong
numbers* rather than absent ones, and the first surface where a number we show
today becomes a number someone is billed from later.

## Decision

### 1. One credit = one AI action on one photo

| event | credits | why |
| --- | --- | --- |
| `image_analyzed` | 1 | one Gemini vision call + its embedding |
| `caption_generated` | 1 | per photo **per language** |
| `embedding` | 0 | the second half of the same analyze call |
| `search_query` | 0 | one cheap parse+embed, and it is the core loop |
| `export` | 0 | R2 + CPU, bounded by the storage limit instead |
| `asset_ingested` | 0 | no model runs |

The rule is chosen so a user can predict spend without a calculator: "300
photos, captions in EN and UK" is 300 + 600 = 900. Two consequences are
load-bearing rather than incidental. `embedding` must stay free because analyze
writes two rows per photo and counting both would silently double every
analysis the day a limit is enforced. `search_query` must stay free because
metering the product's core interaction teaches people not to use it.

This is deliberately **narrower** than the first sketch, which charged for
exports. Charging for the deliverable muddies the sentence above — it stops
being "1 credit = 1 AI action" and becomes a table you have to read — and it
taxes the moment the user gets their value out. Exports are counted and shown
in the activity log; they cost 0.

Storage is a **separate axis in bytes**, never converted to credits. Folding two
resources into one number is the main reason usage pages are unreadable.

### 2. Limits exist, enforcement does not

A `plans` table (`beta` / `creator` / `studio`) with `storage_bytes`,
`monthly_credits` and `enforced`. Every shipped row has `enforced = false`, no
policy or trigger reads a limit, and no code path refuses work. The limits are
there so the UI can draw a denominator — and so the day enforcement lands it
reads numbers collected truthfully from the start instead of invented at billing
time. A null limit means unlimited and the UI drops the meter rather than
rendering a full or empty bar.

Credits reset on the **calendar month**. Anniversary billing needs a
per-workspace period start; adding that column later changes one CTE.

### 3. Measure bytes where they are written

`asset_previews.byte_size`, `asset_edits.thumb_bytes/medium_bytes` and
`ai_jobs.payload.result_bytes` are recorded by the handler that uploads the
buffer, which is the only place that knows the size for free. Rows written
before this are genuinely unmeasured: the columns are nullable, the page reports
how many files are missing rather than pretending a zero is a fact, and
`apps/worker/src/scripts/backfill-derivative-bytes.ts` pays the HeadObject cost
once to clear them.

`ingest` now writes an `asset_ingested` event carrying bytes, and every usage
write goes through `apps/worker/src/services/usage.ts`, which fills `cost_usd`
from a documented per-unit estimate in `packages/shared`. Those USD figures are
**estimates, not a metered bill** — we count units and Gemini prices tokens —
and they are never shown to a user; they exist so margin against a plan price
can be reasoned about at all.

### 4. One RPC, RLS as the boundary

`workspace_usage(ws uuid)` returns the whole page as jsonb, SECURITY INVOKER —
the same posture as `search_assets` (ADR 0031): RLS already scopes every row to
the caller's memberships, so the parameter narrows *within* that boundary rather
than being it. A non-member gets zeros and a null plan. When these aggregates
outgrow a live query the body becomes a read of a worker-maintained daily
rollup and `lib/usage.ts` keeps its shape.

## Consequences

- The credit meter is retroactively correct: it is `sum(units)` over rows
  `usage_events` has been collecting since Phase 2.
- The storage meter is **not** retroactively correct until the backfill runs.
  This is visible in the UI by design rather than hidden by an estimate.
- Per-project attribution double-counts a photo that lives in two projects
  (assets are M:N — ADR 0011), so those rows do not sum to the workspace total.
  The page says so; the alternative — attributing each photo to one "primary"
  project — would invent a relationship the domain model deliberately does not
  have.
- The page's CTA links to the canvas instead of enqueuing analysis for every
  unprocessed photo. A one-click "analyze everything" from a usage page is
  exactly the affordance the 2026-07-10 product decision (AI spend is always an
  explicit, selected user action) exists to prevent.
- `Billing & Plan` and `Account Settings` still toast. A link to a page that
  does not exist is worse than an honest "coming soon", and the two account
  menus (`components/header/AccountDropdown.tsx`,
  `components/home/AccountMenu.tsx`) still carry different item sets — worth
  reconciling when those pages become real, not while they are labels.
