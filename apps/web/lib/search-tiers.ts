import type { SearchTier } from "@archivemind/shared";

/** Relevance tiering for search results (ADR 0029).
 *
 *  search_assets() returns a ranked list with no cutoff — cosine between any
 *  text and any image is always *some* number, so on a small archive every
 *  query used to return the entire archive ("Found 11" for both "dog" and
 *  "girl"). This module draws the honesty line the SQL can't:
 *
 *  - a row that matched an explicit query term (tag or place) is always
 *    "strong" — the user literally named it;
 *  - otherwise a row is "strong" only while it sits within STRONG_DELTA of
 *    the best similarity in the set, capped at STRONG_COSINE_CAP rows so a
 *    flat cross-modal distribution (one-word queries produce these) can't
 *    promote everything.
 *
 *  Absolute similarity thresholds are deliberately absent: cross-modal cosine
 *  bands vary by corpus and model revision, so a fixed floor tuned today lies
 *  tomorrow. The relative gap self-scales. Both knobs are plain constants —
 *  tune them by PR once a real dirty corpus exists (#33), not by env var. */

/** How far below the best similarity a cosine-only row may sit and still be
 *  called strong. */
export const STRONG_DELTA = 0.03;

/** Most cosine-only rows that may be strong — filter-matched rows don't count
 *  against it. */
export const STRONG_COSINE_CAP = 6;

interface TierableRow {
  similarity: number;
  matchedTags: string[];
  matchedPlace: string | null;
}

/** Annotate ranked rows with their tier, preserving order. */
export function assignTiers<T extends TierableRow>(
  rows: T[],
  delta: number = STRONG_DELTA,
  cosineCap: number = STRONG_COSINE_CAP,
): (T & { tier: SearchTier })[] {
  const best = rows.reduce((m, r) => Math.max(m, r.similarity), -Infinity);
  let cosineStrong = 0;
  return rows.map((r) => {
    if (r.matchedTags.length > 0 || r.matchedPlace) return { ...r, tier: "strong" as const };
    if (r.similarity >= best - delta && cosineStrong < cosineCap) {
      cosineStrong += 1;
      return { ...r, tier: "strong" as const };
    }
    return { ...r, tier: "weak" as const };
  });
}
