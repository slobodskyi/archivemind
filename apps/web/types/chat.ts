/** One result row attached to an assistant search answer (#16). `src` is the
 *  already-presigned thumb of the matching loaded photo; absent when the match
 *  sits outside the photos currently on the canvas. */
export interface ChatResult {
  assetId: string;
  src?: string;
  filename: string;
  /** Relevance tier from the search route (ADR 0029): "strong" renders as the
   *  answer, "weak" stays collapsed behind a "show more" toggle. */
  tier: "strong" | "weak";
  matchedTags: string[];
  matchedPlace: string | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  /** Search results backing this answer — rendered as a thumb strip + Select. */
  results?: ChatResult[];
}
