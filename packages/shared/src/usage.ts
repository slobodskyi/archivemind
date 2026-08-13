/** Usage accounting: what a credit is, and what an action costs us.
 *
 *  TECH_SPEC rule 11 logs every AI action in `usage_events` "for the future
 *  credits model" but never says what a credit IS. This module is that
 *  definition, in one place both the worker (which writes the rows) and the web
 *  reader (which totals them) import — so the number on the Usage page can
 *  never drift from the number the billing model would charge.
 *
 *  **1 credit = 1 AI action on 1 photo.**
 *
 *  The rule is chosen to be predictable without a calculator: "300 photos,
 *  captions in EN and UK" is 300 + 600 = 900, and a user can decide whether to
 *  run it before they run it. Two consequences fall out of it:
 *
 *  - `embedding` is worth 0. It is the second half of one analyze call, not a
 *    second action; the worker writes it as its own row for the audit trail
 *    (spec §12) and counting it would silently double every analysis.
 *  - `search_query`, `export`, `asset_ingested` are worth 0. None of them is an
 *    AI action on a photo — search is one cheap parse+embed on the core loop
 *    (charging for it would tax the thing the product is for), and export and
 *    ingest spend R2 and CPU, which the storage limit already bounds. Keeping
 *    them at 0 is what lets the sentence above stay true with no footnotes.
 *  - `content_generated` is one multi-photo synthesis, not one action per photo.
 *    Its pricing unit is recorded but deliberately 0 until a set-level credit
 *    conversion is approved (ADR 0045); silently multiplying by source count
 *    would violate the predictable per-photo definition above.
 *
 *  Nothing here is enforced. `plans.enforced` is false for every shipped plan
 *  and no code path refuses work for lack of credits — this is metering, and
 *  the limits exist so the UI can draw a denominator.
 */

/** Every `usage_events.event_type` the system writes. The column is free text
 *  (no enum in the schema), so this union is the only place the set is closed —
 *  keep it in step with the worker handlers and `app/api/search`. */
export type UsageEventType =
  | "image_analyzed"
  | "embedding"
  | "caption_generated"
  | "search_query"
  | "content_generated"
  | "export"
  | "asset_ingested";

/** Credits charged per `units` of each event. See the module note for why four
 *  of the six are free. */
export const CREDIT_COST: Record<UsageEventType, number> = {
  image_analyzed: 1,
  caption_generated: 1,
  embedding: 0,
  search_query: 0,
  content_generated: 0,
  export: 0,
  asset_ingested: 0,
};

/** Credits for `units` of `type`. Unknown event types cost nothing: a new
 *  handler that forgets to declare itself must not invent a charge.
 *
 *  `Object.hasOwn`, not a plain lookup: an object literal inherits from
 *  `Object.prototype`, so `CREDIT_COST["constructor"]` is a *function*, sails
 *  past an `=== undefined` check and multiplies out to NaN. The same
 *  prototype-walk bug shipped once already in `lib/auth-errors.ts` (#91) and
 *  put a function on the login page. */
export function creditsFor(type: string, units: number): number {
  if (!Object.hasOwn(CREDIT_COST, type)) return 0;
  return (CREDIT_COST as Record<string, number>)[type] * units;
}

/** What one unit costs US, in USD. **These are estimates, not a metered bill** —
 *  we count units, not tokens, and Gemini prices per token. They are here so
 *  `usage_events.cost_usd` (a column that has existed since init and been
 *  written by nobody) carries a number good enough to reason about margin
 *  against the plan prices above.
 *
 *  Sources, all measured against this repo rather than assumed:
 *  - `image_analyzed` ~$0.0004/photo — the Phase-2 figure in docs/PLAN.md, from
 *    a real `gemini-3.1-flash-lite` call with the analyze `responseSchema`.
 *  - `embedding` ~$0.00012/image — `gemini-embedding-2`, re-verified against the
 *    official pricing table when issue #35 closed.
 *  - `caption_generated` ~$0.0003 — same image input as analyze, materially
 *    shorter completion.
 *  - `search_query` ~$0.0002 — two calls per query since Phase 4 (structured
 *    parse + embedding the query text).
 *
 *  Re-derive these whenever the model pins in ADR 0010 move; a stale estimate
 *  here is a wrong margin, never a wrong user-facing number (we never show USD).
 */
export const USD_PER_UNIT: Record<UsageEventType, number> = {
  image_analyzed: 0.0004,
  embedding: 0.00012,
  caption_generated: 0.0003,
  search_query: 0.0002,
  // Token-dependent multi-photo composition has not been benchmarked/priced.
  content_generated: 0,
  export: 0,
  asset_ingested: 0,
};

/** Estimated USD for `units` of `type`, rounded to the 6 decimals
 *  `usage_events.cost_usd numeric(10,6)` actually stores. Null when the event
 *  costs nothing or is unknown, so the column stays NULL rather than recording
 *  a confident zero for something we never priced. */
export function costUsdFor(type: string, units: number): number | null {
  if (!Object.hasOwn(USD_PER_UNIT, type)) return null; // see creditsFor
  const rate = (USD_PER_UNIT as Record<string, number>)[type];
  if (rate === 0) return null;
  return Math.round(rate * units * 1e6) / 1e6;
}

/** Plan ids shipped by migration 20260727000002. The catalog is a table, not an
 *  enum — this type exists for the reader, and an unknown id must degrade to
 *  "unlimited", never throw. */
export type PlanId = "beta" | "creator" | "studio";
