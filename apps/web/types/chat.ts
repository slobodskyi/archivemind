import type { AssetLabel } from "@archivemind/shared";
import type { ViewMode } from "./view";

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
  /** The query text hit this asset's AI description or facts (ADR 0031). */
  matchedText: boolean;
}

/** Something the assistant can do in the app. It is a DESCRIPTION, never the
 *  doing: every kind maps onto a handler a button somewhere already calls
 *  (`runAction` in hooks/useAssistant), so the chat adds no write path of its
 *  own. `filter` mirrors `LabelFilter` in lib/labels. */
export type ChatAction =
  | { kind: "select"; ids: string[] }
  | { kind: "view"; ids: string[] }
  /** `boardId: null` creates a Workspace (optionally named) holding the ids. */
  | { kind: "add_to_board"; ids: string[]; boardId: string | null; name?: string }
  | { kind: "label"; ids: string[]; label: AssetLabel | null }
  | { kind: "share"; ids: string[] }
  | { kind: "download"; ids: string[] }
  | { kind: "analyze"; ids: string[] }
  | { kind: "caption"; ids: string[] }
  | { kind: "trash"; ids: string[] }
  | { kind: "filter_label"; filter: AssetLabel | "none" | null }
  | { kind: "set_view"; view: ViewMode }
  | { kind: "open_board"; boardId: string | null }
  | { kind: "search"; query: string };

/** A button the assistant puts under its own message. `ai` is the purple of
 *  every control that leads to a credit-spending panel; `danger` is Trash. */
export interface ChatOffer {
  label: string;
  action: ChatAction;
  tone?: "ai" | "danger";
}

export interface ChatMessage {
  /** Stable per message — a reply patches its own "Searching…" placeholder by
   *  id, so a message appended meanwhile is never overwritten. */
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Search results backing this answer — a thumb strip plus the action row. */
  results?: ChatResult[];
  /** A secondary remark, set in small print above the offers — what search
   *  could not see, when the answer itself is about what it found. */
  note?: string;
  /** What the assistant proposes next. */
  offers?: ChatOffer[];
}
