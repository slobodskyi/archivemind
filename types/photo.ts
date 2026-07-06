export type PhotoGroup = "rescue" | "aid" | "urban" | "street";

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

/** A photo-group's smart-view hub metadata: label, color, and fixed hub center. */
export interface GroupMeta {
  key: PhotoGroup;
  label: string;
  color: string;
  hx: number;
  hy: number;
}

/** A country's map-view metadata: fractional center (0-1) within the map bounds, plus color. */
export interface CountryMeta {
  cx: number;
  cy: number;
  color: string;
}

export interface Photo {
  id: string;
  seed: string;
  /** Native aspect-ratio basis (mock "megapixel" dimensions). */
  w: number;
  h: number;
  /** Hand-authored seed coords — canvas view's default position; also mutated by canvas drag. */
  x: number;
  y: number;
  /** Precomputed display filename, e.g. "DSC_04812.jpg". */
  filename: string;
  processed: boolean;
  status: PhotoStatus;
  captionKey: CaptionKey | null;
  captionStyle: CaptionStyle;
  /** Authored short-caption teaser, shown as the bottom pill chip on processed tiles. */
  chip: string | null;
  tags: string[] | null;
  facts: Fact[];
  /** Display-only 'MM-DD HH:mm'; parsed by the timeline layout's time sort. */
  time: string;
  /** Display-only 'Mon DD'; used for timeline tick labels. */
  day: string;
  group: PhotoGroup;
  country: string;
  exif: ExifData;
  /** CSS animation shorthand for entrance ("none" normally; a fade-in for freshly-uploaded photos). */
  anim: string;
}
