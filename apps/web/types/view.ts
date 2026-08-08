/** The internal ids and the on-screen labels disagree by design (see
 *  ARCHITECTURE.md): `neural` = "CANVAS", `sense` = "TOPIC". `labels` is the
 *  one that means what it says — the colour-label clouds. */
export type ViewMode = "neural" | "timeline" | "map" | "sense" | "labels";

/** `ink` and `eraser` are Workspace-view-only (ADR 0041), like the annotations
 *  they act on. Note that the tool is not the only way to draw: an Apple Pencil
 *  draws whatever tool is selected — see `useWorkspace`'s pointer handling. */
export type Tool = "select" | "hand" | "frame" | "ink" | "eraser";
