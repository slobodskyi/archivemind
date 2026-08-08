/** The internal ids and the on-screen labels disagree by design (see
 *  ARCHITECTURE.md): `neural` = "CANVAS", `sense` = "TOPIC". `labels` is the
 *  one that means what it says — the colour-label clouds. */
export type ViewMode = "neural" | "timeline" | "map" | "sense" | "labels";

export type Tool = "select" | "hand" | "frame";
