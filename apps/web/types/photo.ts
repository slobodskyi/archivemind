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
  gpsLat: number;
  gpsLon: number;
  gpsLabel: string;
  iso: number;
  aperture: string;
  shutter: string;
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
  group: PhotoGroup;
  country: string;
  source: PhotoSource;
  /** Folder name within `source`'s own filesystem — real per-source browsing hierarchy. */
  folder: string;
  project: ProjectKey;
  exif: ExifData;
}
