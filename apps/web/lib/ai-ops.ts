import { CAPTION_LANG_DB, CAPTION_STYLE_DB } from "./format";
import type { CaptionStyle, Language } from "@/types";

/** The AI operations the app can actually run. Both map to a real job type in
 *  `jobTypeSchema` and a real worker handler — if something can be checked in
 *  the AI panel, it exists here and it runs. */
export interface AiOps {
  /** analyze — tags, facts, embeddings; what makes a photo searchable. */
  tags: boolean;
  /** caption — styled text per language. */
  captions: boolean;
}

export interface CaptionJobSpec {
  assetIds: string[];
  langs: ("en" | "uk" | "ru")[];
  style: "social" | "agency" | "archival";
}

export type AnalyzeJobSpec = { assetIds: string[] };

export type AiPlanBlock = "no-selection" | "no-ops" | "no-langs";

export interface AiPlan {
  /** null when the run is valid; otherwise why it can't start. */
  blocked: AiPlanBlock | null;
  /** The job to enqueue first, if any. */
  analyze: AnalyzeJobSpec | null;
  /** The caption job — enqueued immediately when `analyze` is null, or chained
   *  behind the analyze job when both were asked for (captions are written from
   *  the facts analysis produces, so they must not race it). */
  caption: CaptionJobSpec | null;
  /** Model calls this run will make: one per photo to analyze, plus one per
   *  photo per language to caption. */
  calls: number;
  /** Button text and progress copy — derived here so the label can never again
   *  describe work the run doesn't do. */
  cta: string;
}

const BLOCKED_CTA: Record<AiPlanBlock, string> = {
  "no-selection": "Select photos first",
  "no-ops": "Pick an operation",
  "no-langs": "Pick a caption language",
};

/** Single source of truth for "what does pressing this button do".
 *
 *  This exists because the answer used to differ per call site: the bulk panel
 *  rendered caption controls over a button hardcoded to `analyze`, and the
 *  drawer's "Generate caption" enqueued `analyze` too — so the one control
 *  actually labelled "caption" never produced one. Label and work are computed
 *  together here, from the same input, so they cannot drift apart again. */
export function planAiRun(
  assetIds: string[],
  ops: AiOps,
  langs: Language[],
  style: CaptionStyle,
): AiPlan {
  const empty = { analyze: null, caption: null, calls: 0 };
  if (assetIds.length === 0) {
    return { ...empty, blocked: "no-selection", cta: BLOCKED_CTA["no-selection"] };
  }
  if (!ops.tags && !ops.captions) {
    return { ...empty, blocked: "no-ops", cta: BLOCKED_CTA["no-ops"] };
  }
  if (ops.captions && langs.length === 0) {
    return { ...empty, blocked: "no-langs", cta: BLOCKED_CTA["no-langs"] };
  }

  const n = assetIds.length;
  const noun = n === 1 ? "photo" : "photos";
  const analyze = ops.tags ? { assetIds } : null;
  const caption = ops.captions
    ? {
        assetIds,
        langs: langs.map((l) => CAPTION_LANG_DB[l]),
        style: CAPTION_STYLE_DB[style],
      }
    : null;

  return {
    blocked: null,
    analyze,
    caption,
    calls: (ops.tags ? n : 0) + (ops.captions ? n * langs.length : 0),
    cta:
      analyze && caption
        ? `Analyze & caption ${n} ${noun}`
        : caption
          ? `Caption ${n} ${noun}`
          : `Analyze ${n} ${noun}`,
  };
}
