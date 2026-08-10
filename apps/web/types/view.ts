/** The internal ids and the on-screen labels disagree by design (see
 *  ARCHITECTURE.md): `neural` = "CANVAS", `sense` = "TOPIC". The colour-label
 *  view was retired (ADR 0040 amended) — labels are now a per-tile marker plus
 *  a bottom-bar control, not a sorting view of their own. */
export type ViewMode = "neural" | "timeline" | "map" | "sense";

/** Drawing moved onto the sticky note (ADR 0041 as amended) — there is no
 *  standalone canvas pencil/eraser tool any more; a note owns its own pencil. */
export type Tool = "select" | "hand" | "frame";
