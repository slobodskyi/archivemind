import type {
  Caption,
  CaptionKey,
  CaptionStyle,
  CountryMeta,
  ExifData,
  Fact,
  FactStatus,
  GroupMeta,
  Photo,
  PhotoGroup,
  PhotoStatus,
} from "@/types";

/**
 * All mock/demo data for ArchiveMind, ported verbatim from the Claude Design
 * `.dc.html` export (v2 redesign — see docs/design/ArchiveMind-v2.dc.html and
 * docs/decisions/0006-redesign-v2-full-replace.md). This is the ONLY place raw
 * data lives — components read it through `lib/api.ts`, never directly, so the
 * whole set can later be swapped for a real backend without touching the UI.
 */

// ── Static lookup tables (verbatim labels/colors from source) ───────────────

export const CAPTIONS: Record<CaptionKey, Caption> = {
  a: {
    EN: "Medical workers treat a wounded civilian in an underground clinic during shelling in Kyiv, Ukraine, 18 June 2026.",
    UK: "Медики надають допомогу пораненому цивільному в підземній клініці під час обстрілу. Київ, Україна, 18 червня 2026 року.",
    RU: "Медики оказывают помощь раненому гражданскому в подземной клинике во время обстрела. Киев, Украина, 18 июня 2026 года.",
  },
  b: {
    EN: "Rescue workers clear rubble from a residential building after a missile strike in the Solomianskyi district of Kyiv, 17 June 2026.",
    UK: "Рятувальники розбирають завали житлового будинку після ракетного удару в Солом'янському районі Києва, 17 червня 2026 року.",
    RU: "Спасатели разбирают завалы жилого дома после ракетного удара в Соломенском районе Киева, 17 июня 2026 года.",
  },
  c: {
    EN: "Portrait of a volunteer at a humanitarian aid distribution point. Identity withheld pending consent. Kyiv region, June 2026.",
    UK: "Портрет волонтера на пункті видачі гуманітарної допомоги. Особу не розкрито до отримання згоди. Київська область, червень 2026 року.",
    RU: "Портрет волонтёра на пункте выдачи гуманитарной помощи. Личность не раскрыта до получения согласия. Киевская область, июнь 2026 года.",
  },
  gen: {
    EN: "Scene from the Kyiv frontline archive documenting civilian life and emergency response, June 2026.",
    UK: "Сцена з київського фронтового архіву: цивільне життя та реагування на надзвичайні ситуації, червень 2026 року.",
    RU: "Сцена из киевского фронтового архива: гражданская жизнь и реагирование на чрезвычайные ситуации, июнь 2026 года.",
  },
};

export const STATUS_META: Record<PhotoStatus, { color: string; label: string }> = {
  Verified: { color: "#22c55e", label: "Verified" },
  Likely: { color: "#f4b740", label: "Likely" },
  "Needs check": { color: "#9aa0a6", label: "Needs check" },
};

/** The 4 smart-view groups, each with a fixed hub center (hx/hy). */
export const GROUPS: Record<PhotoGroup, GroupMeta> = {
  rescue: { key: "rescue", label: "Medical & Rescue", color: "#ff7a5c", hx: 470, hy: 330 },
  aid: { key: "aid", label: "Civilians & Aid", color: "#5b9bff", hx: 1080, hy: 330 },
  urban: { key: "urban", label: "Urban Landscape", color: "#4fd1c5", hx: 470, hy: 780 },
  street: { key: "street", label: "Documentary Street", color: "#c084fc", hx: 1080, hy: 780 },
};

/** Map-view countries: fractional center (0-1 within the map bounds) + color. */
export const COUNTRIES: Record<string, CountryMeta> = {
  "United Kingdom": { cx: 0.27, cy: 0.3, color: "#5b9bff" },
  Sweden: { cx: 0.55, cy: 0.12, color: "#4fd1c5" },
  Germany: { cx: 0.5, cy: 0.43, color: "#c084fc" },
  Poland: { cx: 0.64, cy: 0.37, color: "#ffb454" },
  France: { cx: 0.33, cy: 0.56, color: "#ff7a5c" },
  Ukraine: { cx: 0.77, cy: 0.47, color: "#7c5cff" },
  Italy: { cx: 0.53, cy: 0.7, color: "#5be0a0" },
  Spain: { cx: 0.23, cy: 0.79, color: "#f06aa0" },
};

/**
 * Static EXIF block — in the source mockup this same block is shown for every
 * photo. We carry it as real per-photo data so a future backend can vary it.
 */
export const EXIF_BLOCK: ExifData = {
  camera: "Nikon Z6 II",
  lens: "24–70mm f/2.8",
  dateTaken: "2026-06-18 23:41",
  gpsLat: 50.4501,
  gpsLon: 30.5234,
  gpsLabel: "Kyiv",
  iso: 6400,
  aperture: "f/2.8",
  shutter: "1/125s",
};

// ── Photo generation (verbatim algorithm from source, typed) ────────────────

const FACT_STATUS_BY_HEX: Record<string, FactStatus> = {
  "#22c55e": "confirmed",
  "#f4b740": "pending",
  "#9aa0a6": "unknown",
};

function factStatus(hex: string): FactStatus {
  return FACT_STATUS_BY_HEX[hex] ?? "unknown";
}

/** Source's exact drawer filename formula. */
export function makeFilename(id: string): string {
  return "DSC_0" + (4800 + ((id.charCodeAt(0) * 7) % 200)) + ".jpg";
}

// Shape used only during generation, mirroring the source's mutable objects.
interface RawFact {
  text: string;
  color: string;
}
interface RawPhoto {
  id: string;
  seed: string;
  w: number;
  h: number;
  x: number;
  y: number;
  processed: boolean;
  status: PhotoStatus;
  cap: CaptionKey | null;
  tags: string[] | null;
  baseStyle: CaptionStyle;
  chip?: string;
  facts?: RawFact[];
  time?: string;
  day?: string;
  group?: PhotoGroup;
  country?: string;
}
type RawExtra = Partial<RawPhoto>;
interface MetaEntry {
  time: string;
  day: string;
  group: PhotoGroup;
  country: string;
}

function generatePhotos(): Photo[] {
  const P = (
    id: string,
    seed: string,
    w: number,
    h: number,
    x: number,
    y: number,
    o?: RawExtra,
  ): RawPhoto =>
    Object.assign(
      {
        id,
        seed,
        w,
        h,
        x,
        y,
        processed: false,
        status: "Needs check" as PhotoStatus,
        cap: null,
        tags: null,
        baseStyle: "Agency" as CaptionStyle,
      },
      o || {},
    );

  const META: Record<string, MetaEntry> = {
    a: { time: "06-18 23:41", day: "Jun 18", group: "rescue", country: "Ukraine" },
    b: { time: "06-17 14:20", day: "Jun 17", group: "rescue", country: "Ukraine" },
    c: { time: "06-19 11:05", day: "Jun 19", group: "aid", country: "Poland" },
    d: { time: "06-18 13:30", day: "Jun 18", group: "aid", country: "Germany" },
    e: { time: "06-16 18:45", day: "Jun 16", group: "urban", country: "United Kingdom" },
    f: { time: "06-17 09:10", day: "Jun 17", group: "street", country: "France" },
    g: { time: "06-18 22:15", day: "Jun 18", group: "rescue", country: "Ukraine" },
    h: { time: "06-19 20:30", day: "Jun 19", group: "urban", country: "Sweden" },
    i: { time: "06-16 08:00", day: "Jun 16", group: "street", country: "United Kingdom" },
    j: { time: "06-17 16:40", day: "Jun 17", group: "aid", country: "France" },
    k: { time: "06-19 12:00", day: "Jun 19", group: "street", country: "Spain" },
    l: { time: "06-18 17:20", day: "Jun 18", group: "urban", country: "Italy" },
  };

  const raw: RawPhoto[] = [
    P("a", "am-medics", 280, 188, 520, 260, { processed: true, status: "Verified", cap: "a", baseStyle: "Agency", chip: "Medical workers treat a wounded civilian in an underground clinic…", tags: ["medics", "operating room", "civilian", "night", "Kyiv"], facts: [{ text: "Location: confirmed via GPS", color: "#22c55e" }, { text: "Date: confirmed via EXIF", color: "#22c55e" }, { text: "People: names require verification", color: "#f4b740" }] }),
    P("b", "am-rescue", 300, 196, 836, 232, { processed: true, status: "Likely", cap: "b", baseStyle: "Agency", chip: "Rescue workers clear rubble from a residential building after a missile strike…", tags: ["rescue", "rubble", "building", "daytime", "Kyiv"], facts: [{ text: "Location: matched to district", color: "#f4b740" }, { text: "Date: confirmed via EXIF", color: "#22c55e" }, { text: "Event: cross-reference pending", color: "#f4b740" }] }),
    P("c", "am-portrait", 200, 258, 564, 560, { processed: true, status: "Needs check", cap: "c", baseStyle: "Archival", chip: "Portrait of a volunteer at a humanitarian aid distribution point…", tags: ["portrait", "volunteer", "aid", "indoor"], facts: [{ text: "Location: approximate", color: "#9aa0a6" }, { text: "Identity: consent required", color: "#9aa0a6" }, { text: "Date: confirmed via EXIF", color: "#22c55e" }] }),
    P("d", "am-crowd", 244, 162, 866, 524, { processed: true, status: "Verified", cap: "gen", baseStyle: "Agency", chip: "Civilians gather at an aid distribution point in central Kyiv…", tags: ["crowd", "aid", "street", "daytime", "Kyiv"], facts: [{ text: "Location: confirmed via GPS", color: "#22c55e" }, { text: "Date: confirmed via EXIF", color: "#22c55e" }] }),
    P("e", "am-street1", 232, 156, 268, 372),
    P("f", "am-street2", 220, 278, 300, 632),
    P("g", "am-night1", 248, 166, 1140, 300),
    P("h", "am-night2", 236, 300, 1148, 556),
    P("i", "am-doc1", 256, 172, 632, 96),
    P("j", "am-doc2", 224, 150, 968, 92),
    P("k", "am-doc3", 240, 300, 420, 838),
    P("l", "am-doc4", 268, 178, 776, 812),
  ].map((p) => {
    Object.assign(p, META[p.id] || {});
    if (!p.facts) p.facts = [{ text: "Analyze to extract facts", color: "#9aa0a6" }];
    return p;
  });

  // Map the raw generated objects onto the typed Photo domain shape.
  return raw.map((p): Photo => ({
    id: p.id,
    seed: p.seed,
    w: p.w,
    h: p.h,
    x: p.x,
    y: p.y,
    filename: makeFilename(p.id),
    processed: p.processed,
    status: p.status,
    captionKey: p.cap,
    captionStyle: p.baseStyle,
    chip: p.chip ?? null,
    tags: p.tags,
    facts: (p.facts ?? []).map((f): Fact => ({ text: f.text, status: factStatus(f.color) })),
    time: p.time ?? "",
    day: p.day ?? "",
    group: p.group as PhotoGroup,
    country: p.country ?? "Ukraine",
    exif: { ...EXIF_BLOCK },
    anim: "none",
  }));
}

/** The full mock archive — 12 hand-authored photos, generated once at module load. */
export const PHOTOS: Photo[] = generatePhotos();

export const GROUP_LIST: GroupMeta[] = Object.values(GROUPS);
