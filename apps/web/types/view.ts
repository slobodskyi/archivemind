/** The internal ids and the on-screen labels disagree by design (see
 *  ARCHITECTURE.md): `neural` = "CANVAS", `sense` = "TOPIC". The colour-label
 *  view was retired (ADR 0040, amended) — a colour is a per-tile marker you read
 *  without leaving the view you're in, not a fourth way to sort. */
export type ViewMode = "neural" | "timeline" | "map" | "sense";

/** Drawing moved onto the sticky note (ADR 0041 as amended), and artboards were
 *  retired in favour of explicit Workspace membership (ADR 0044 amended).
 *  Canvas therefore exposes only selection and panning. */
export type Tool = "select" | "hand";
