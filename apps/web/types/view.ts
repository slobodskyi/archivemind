/** The internal ids and the on-screen labels disagree by design (see
 *  ARCHITECTURE.md): `neural` = "CANVAS", `sense` = "TOPIC". The colour-label
 *  view was retired (ADR 0040, amended) — a colour is a per-tile marker you read
 *  without leaving the view you're in, not a fourth way to sort. */
export type ViewMode = "neural" | "timeline" | "map" | "sense";

/** `ink` and `eraser` are Workspace-view-only (ADR 0041), like the annotations
 *  they act on. Note that the tool is not the only way to draw: an Apple Pencil
 *  draws whatever tool is selected — see `useWorkspace`'s pointer handling. */
export type Tool = "select" | "hand" | "frame" | "ink" | "eraser";
