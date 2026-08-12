/** The internal ids and the on-screen labels disagree by design (see
 *  ARCHITECTURE.md): `neural` = "CANVAS", `sense` = "TOPIC". The colour-label
 *  view was retired (ADR 0040, amended) — a colour is a per-tile marker you read
 *  without leaving the view you're in, not a fourth way to sort. */
export type ViewMode = "neural" | "timeline" | "map" | "sense";

/** Drawing moved onto the sticky note (ADR 0041 as amended) — there is no
 *  standalone canvas pencil or eraser any more, so no tool for one. A note owns
 *  its own pencil, in its own mode, inside its own card. */
export type Tool = "select" | "hand" | "frame";
