import type { SupabaseClient } from "@supabase/supabase-js";
import { ASSET_LABELS, DEFAULT_LABEL_NAMES, type AssetLabel, type LabelNames } from "@archivemind/shared";
import type { Photo } from "@/types";

/** Colour labels (migration 20260808000001) — the human curation axis that sits
 *  beside the AI one: a tag says what is in the photo, a label says what you are
 *  doing with it. Names are per workspace and renameable; the hexes are not,
 *  because the whole point is that a colour reads the same everywhere. */

/** The seven swatches, tuned one step brighter than macOS's own so they hold up
 *  as 8px dots on this canvas's near-black surfaces. Order comes from
 *  ASSET_LABELS — never re-sort here, the swatch row and the LABELS view both
 *  read that order. */
export const LABEL_COLORS: Record<AssetLabel, string> = {
  red: "#ff5f57",
  orange: "#ff9f2e",
  yellow: "#ffd426",
  green: "#3ddc6b",
  blue: "#4a9dff",
  purple: "#c07bf5",
  gray: "#9aa0a6",
};

/** A sticky note's fill (ADR 0041). The same seven colours, mixed most of the
 *  way to white: an 8px dot needs the full-strength swatch to register, while a
 *  180px card filled with `#ff5f57` reads as an alarm rather than a note — and
 *  the note's text is near-black, which needs a light ground. Paper, in other
 *  words. The hue is still unmistakably the label's, so the two swatch rows
 *  match without being the same weight. */
export function noteSurface(label: AssetLabel): string {
  const hex = LABEL_COLORS[label];
  const n = parseInt(hex.slice(1), 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * 0.62);
  return `rgb(${mix((n >> 16) & 255)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

/** The LABELS view's cloud for everything unmarked. A string, not null, because
 *  buildCloudLayout groups by a string key — and it is capitalised like every
 *  other cloud key (Unsorted / Other) so the three read as siblings. */
export const NO_LABEL_CLOUD_KEY = "No label";

/** Neutral grey for the "No label" cloud — deliberately dimmer than the `gray`
 *  swatch, which is a real choice a user made and must not look like absence. */
export const NO_LABEL_COLOR = "#4a4a4a";

/** Overrides merged onto the defaults. Pure and total: every colour always has
 *  a name, so no caller needs a fallback branch. A blank/whitespace override is
 *  ignored rather than rendered as an empty chip — the rename route rejects one
 *  too, but a row could predate that or arrive from a direct DB edit. */
export function resolveLabelNames(overrides: readonly { label: string; name: string }[]): LabelNames {
  const names = { ...DEFAULT_LABEL_NAMES };
  for (const row of overrides) {
    const label = row.label as AssetLabel;
    if (!ASSET_LABELS.includes(label)) continue; // value from a future migration
    const name = row.name?.trim();
    if (name) names[label] = name;
  }
  return names;
}

/** How many of these photos carry each colour, plus the unlabelled remainder.
 *  Counted over the photos actually loaded (the canvas reads the newest 500),
 *  which is what the filter strip claims — it counts what you are looking at,
 *  not the archive. */
export function labelCounts(photos: readonly Photo[]): Record<AssetLabel | "none", number> {
  const counts = { none: 0 } as Record<AssetLabel | "none", number>;
  for (const label of ASSET_LABELS) counts[label] = 0;
  for (const photo of photos) {
    if (photo.label) counts[photo.label] += 1;
    else counts.none += 1;
  }
  return counts;
}

/** The active filter applied. `null` = no filter (everything); "none" = the
 *  unlabelled ones, which is a real thing to want ("what haven't I triaged?")
 *  and is why the filter is not simply `AssetLabel | null`. */
export type LabelFilter = AssetLabel | "none" | null;

export function filterByLabel(photos: readonly Photo[], filter: LabelFilter): Photo[] {
  if (!filter) return [...photos];
  if (filter === "none") return photos.filter((p) => !p.label);
  return photos.filter((p) => p.label === filter);
}

/** The caller's workspace label names (RLS-scoped). Only renamed colours have a
 *  row, so an empty table is the correct, fully-default answer. */
export async function getLabelNames(supabase: SupabaseClient): Promise<LabelNames> {
  const { data, error } = await supabase.from("workspace_labels").select("label, name");
  // Migration 20260808000001 not applied to this DB yet — degrade to the
  // defaults instead of a hard crash, same posture as getCanvasGroups.
  // 42P01 = undefined_table.
  if (error?.code === "42P01" || error?.code === "42703") return { ...DEFAULT_LABEL_NAMES };
  if (error) throw error;
  return resolveLabelNames((data ?? []) as { label: string; name: string }[]);
}
