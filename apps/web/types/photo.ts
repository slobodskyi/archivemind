import type { AssetLabel } from "@archivemind/shared";

export type PhotoSource = "gdrive" | "icloud" | "dropbox" | "upload";

/** Topic-cloud key. The old fixed union (rescue/aid/urban/…) survives only as
 *  mock seed keys with curated GROUPS colors; real assets carry a topic
 *  DERIVED from their AI tags (lib/topics.ts, ADR 0023) — any string. */
export type PhotoGroup = string;

/** The 3 seed projects are still valid values, but any string is a valid
 * project key — user-created projects (from the sidebar "new project" flow)
 * get a generated key at runtime. */
export type ProjectKey = string;

export type PhotoStatus = "Verified" | "Likely" | "Needs check";

/** Verification state of a single extracted fact. Maps to the source's 3 dot colors. */
export type FactStatus = "confirmed" | "pending" | "unknown";

export type CaptionStyle = "Social" | "Agency" | "Archival";

export type Language = "EN" | "UK" | "RU";

/** Key into the CAPTIONS map; null until a photo is processed. */
export type CaptionKey = "a" | "b" | "c" | "gen";

export interface Fact {
  /** DB row id, needed to PATCH a verdict. null for the synthetic
   *  "Analyze to extract facts" placeholder, which has no row behind it. */
  id: string | null;
  text: string;
  status: FactStatus;
}

/** A multilingual caption: one string per supported language. */
export type Caption = Record<Language, string>;

/** One real caption row (DB `captions`) surfaced to the UI. */
export interface CaptionRow {
  id: string;
  text: string;
  edited: boolean;
}

/** Real captions per language × style; a missing key = not generated yet. */
export type PhotoCaptions = Partial<Record<Language, Partial<Record<CaptionStyle, CaptionRow>>>>;

export interface ExifData {
  camera: string;
  lens: string;
  dateTaken: string;
  /** null = the file carries no GPS at all (messengers strip EXIF, most pro
   *  bodies have no receiver). Distinct from 0, which is a real place in the
   *  Gulf of Guinea — the Map view must plot one and skip the other. */
  gpsLat: number | null;
  gpsLon: number | null;
  /** Reverse-geocoded place, e.g. "Odesa, Ukraine"; "" until the worker fills it. */
  gpsLabel: string;
  iso: number;
  aperture: string;
  shutter: string;
  /** `asset_exif` columns a human has corrected by hand (migration
   *  20260805000001) — DB column names, e.g. "camera_model", "taken_at". Drives
   *  the drawer's per-field "edited" marks and whether Revert is offered. Empty
   *  for mock rows and for anything nobody has touched. */
  editedFields: string[];
  /** The ISO-8601 instant behind `dateTaken`, for the editor's datetime input.
   *  `dateTaken` itself is a display string in local time and cannot be parsed
   *  back without guessing a timezone. null when the asset has no taken_at and
   *  the display value fell back to created_at. */
  takenAtIso: string | null;
}

export interface Photo {
  id: string;
  seed: string;
  /** Real preview URLs (presigned R2). When absent, the UI falls back to the
   *  mock picsum source keyed by `seed`. */
  src?: string;
  srcMedium?: string;
  /** Native aspect-ratio basis (mock "megapixel" dimensions). */
  w: number;
  h: number;
  /** Hand-authored seed coords — retained for data fidelity; neural layout does not read them. */
  x: number;
  y: number;
  /** Precomputed display filename, e.g. "DSC_04812.jpg". */
  filename: string;
  processed: boolean;
  status: PhotoStatus;
  captionKey: CaptionKey | null;
  captionStyle: CaptionStyle;
  /** Real caption rows keyed lang × style (absent on mock rows). */
  captions?: PhotoCaptions;
  /** Authored short-caption teaser; not surfaced in the current UI. */
  chip: string | null;
  tags: string[] | null;
  facts: Fact[];
  /** Display-only 'MM-DD HH:mm'. Not used for timeline bucketing. */
  time: string;
  /** Display-only 'Mon DD'. */
  day: string;
  /** Effective Topic display label. This is deliberately not cloud identity:
   *  a stored cluster can be renamed without moving its files or changing its
   *  color. See `topicKey` below. */
  group: PhotoGroup;
  /** Machine-owned k-means baseline (`assets.cluster_id`). It remains visible
   *  while a manual assignment wins so Return to AI does not need to guess. */
  autoClusterId?: string | null;
  /** User-owned membership override. Null means the AI baseline is effective. */
  manualClusterId?: string | null;
  /** Stable key + display label of the AI baseline, including a namespaced
   *  synthetic key when the baseline came from the tag heuristic. */
  autoTopicKey?: string | null;
  autoTopicLabel?: PhotoGroup | null;
  /** Effective stored cluster UUID (manual first, then auto), or null on the
   *  heuristic/system path. Kept separate from `topicKey` so callers can tell
   *  whether rename/assignment APIs apply. */
  topicId?: string | null;
  /** Effective stable cloud identity. Stored topics use their UUID; heuristic
   *  and system topics use synthetic keys from `lib/topics.ts`. Topic layout,
   *  focus and color use this field; `group` is display-only. */
  topicKey?: string | null;
  country: string;
  /** User-assigned colour label (`assets.label`, migration 20260808000001) —
   *  null/absent = unlabelled. Human curation, never AI: it is what the LABELS
   *  view groups by and what the label filter narrows to. Absent on mock rows. */
  label?: AssetLabel | null;
  source: PhotoSource;
  /** True when a non-destructive edit (ADR 0030) is applied — `src`/`srcMedium`
   *  then point at the edited previews, and the drawer offers Reset. */
  edited?: boolean;
  /** Folder name within `source`'s own filesystem — real per-source browsing hierarchy. */
  folder: string;
  project: ProjectKey;
  exif: ExifData;
}
