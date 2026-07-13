import type {
  Caption,
  CaptionKey,
  CaptionStyle,
  ExifData,
  Fact,
  FactStatus,
  GroupMeta,
  Photo,
  PhotoGroup,
  PhotoSource,
  PhotoStatus,
  Project,
  ProjectKey,
  SourceMeta,
} from "@/types";

/**
 * All mock/demo data for ArchiveMind, ported verbatim from the Claude Design
 * `.dc.html` export. This is the ONLY place raw data lives — components read it
 * through `lib/api.ts`, never directly, so the whole set can later be swapped
 * for a real backend without touching the UI.
 */

// ── Static lookup tables (verbatim labels/colors from source) ───────────────

export const CAPTIONS: Record<CaptionKey, Caption> = {
  a: {
    EN: "Medical workers treat a wounded civilian in an underground clinic during shelling in Kyiv, Ukraine, 18 June 2026.",
    UK: "Медики надають допомогу пораненому цивільному в підземній клініці під час обстрілу. Київ, 18 червня 2026.",
    RU: "Медики оказывают помощь раненому в подземной клинике во время обстрела. Киев, 18 июня 2026.",
  },
  b: {
    EN: "Rescue workers clear rubble from a residential building after a missile strike in the Solomianskyi district of Kyiv, 17 June 2026.",
    UK: "Рятувальники розбирають завали житлового будинку після ракетного удару в Солом'янському районі Києва, 17 червня 2026.",
    RU: "Спасатели разбирают завалы жилого дома после ракетного удара в Соломенском районе Киева, 17 июня 2026.",
  },
  c: {
    EN: "Portrait of a volunteer at a humanitarian aid distribution point. Identity withheld pending consent. Kyiv region, June 2026.",
    UK: "Портрет волонтера на пункті видачі гуманітарної допомоги. Особу не розкрито до згоди. Київська область, 2026.",
    RU: "Портрет волонтёра на пункте выдачи помощи. Личность не раскрыта до согласия. Киевская область, 2026.",
  },
  gen: {
    EN: "Scene from the Kyiv frontline archive documenting civilian life and emergency response, June 2026.",
    UK: "Сцена з київського фронтового архіву, червень 2026.",
    RU: "Сцена из киевского фронтового архива, июнь 2026.",
  },
};

export const STATUS_META: Record<PhotoStatus, { color: string; label: string }> = {
  Verified: { color: "#22c55e", label: "Verified" },
  Likely: { color: "#f4b740", label: "Likely" },
  "Needs check": { color: "#9aa0a6", label: "Needs check" },
};

export const GROUPS: Record<PhotoGroup, GroupMeta> = {
  rescue: { key: "rescue", label: "Rescue", color: "#ff7a5c" },
  aid: { key: "aid", label: "Aid", color: "#5b9bff" },
  urban: { key: "urban", label: "Urban", color: "#4fd1c5" },
  street: { key: "street", label: "Street", color: "#c084fc" },
  portraits: { key: "portraits", label: "Portraits", color: "#ffd166" },
  aerial: { key: "aerial", label: "Aerial", color: "#ff9ff3" },
  night: { key: "night", label: "Night", color: "#a0e7e5" },
  archive: { key: "archive", label: "Archive", color: "#f8a488" },
};

export const SOURCES: Record<PhotoSource, SourceMeta> = {
  gdrive: { key: "gdrive", color: "#4285F4", label: "Google Drive", abbr: "GD" },
  icloud: { key: "icloud", color: "#39ff6a", label: "iCloud", abbr: "iC" },
  dropbox: { key: "dropbox", color: "#00C2FF", label: "Dropbox", abbr: "DB" },
  upload: { key: "upload", color: "#b48cff", label: "Local", abbr: "LC" },
};

/** Each connected source's own real folder structure, browsed via the Neural drill-down. */
export const SOURCE_FOLDERS: Record<PhotoSource, string[]> = {
  upload: ["Uploads"],
  gdrive: ["2024 Shoots", "Raw Imports", "Client Deliverables", "Archive Backup"],
  icloud: ["Camera Roll", "Screenshots", "Shared Albums", "Recently Added"],
  dropbox: ["Client Proofs", "Team Shared", "Edits WIP", "Final Exports"],
};

/** Tiny djb2-style hash — local copy to avoid a circular import with lib/layout.ts. */
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h;
}

export const PROJECTS_META: Record<ProjectKey, { label: string; color: string }> = {
  frontline: { label: "Kyiv 2026 — Frontline", color: "#5b9bff" },
  travel: { label: "Travel 2025", color: "#ff7a5c" },
  client: { label: "Client Work", color: "#5b9bff" },
};

export const COUNTRY_LATLON: Record<string, [number, number]> = {
  Ukraine: [50.45, 30.52],
  Poland: [52.23, 21.01],
  Germany: [52.52, 13.4],
  France: [48.86, 2.35],
  "United Kingdom": [51.51, -0.13],
  Sweden: [59.33, 18.07],
  Italy: [41.9, 12.5],
  Spain: [40.42, -3.7],
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
function makeFilename(id: string): string {
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
  source?: PhotoSource;
  project?: ProjectKey;
}
type RawExtra = Partial<RawPhoto>;
interface MetaEntry {
  time: string;
  day: string;
  group: PhotoGroup;
  country: string;
  source: PhotoSource;
  project: ProjectKey;
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
    a: { time: "06-18 23:41", day: "Jun 18", group: "rescue", country: "Ukraine", source: "gdrive", project: "frontline" },
    b: { time: "06-17 14:20", day: "Jun 17", group: "rescue", country: "Ukraine", source: "gdrive", project: "frontline" },
    c: { time: "06-19 11:05", day: "Jun 19", group: "aid", country: "Poland", source: "icloud", project: "frontline" },
    d: { time: "06-18 13:30", day: "Jun 18", group: "aid", country: "Germany", source: "icloud", project: "frontline" },
    e: { time: "06-16 18:45", day: "Jun 16", group: "urban", country: "United Kingdom", source: "dropbox", project: "frontline" },
    f: { time: "06-17 09:10", day: "Jun 17", group: "street", country: "France", source: "gdrive", project: "frontline" },
    g: { time: "06-18 22:15", day: "Jun 18", group: "rescue", country: "Ukraine", source: "gdrive", project: "frontline" },
    h: { time: "06-19 20:30", day: "Jun 19", group: "urban", country: "Sweden", source: "icloud", project: "frontline" },
    i: { time: "06-16 08:00", day: "Jun 16", group: "street", country: "United Kingdom", source: "dropbox", project: "frontline" },
    j: { time: "06-17 16:40", day: "Jun 17", group: "aid", country: "France", source: "icloud", project: "frontline" },
    k: { time: "06-19 12:00", day: "Jun 19", group: "street", country: "Spain", source: "dropbox", project: "frontline" },
    l: { time: "06-18 17:20", day: "Jun 18", group: "urban", country: "Italy", source: "dropbox", project: "frontline" },
    p1: { time: "06-16 12:00", day: "Jun 16", group: "portraits", country: "Ukraine", source: "gdrive", project: "travel" },
    p2: { time: "06-17 08:30", day: "Jun 17", group: "portraits", country: "Poland", source: "icloud", project: "travel" },
    p3: { time: "06-18 15:00", day: "Jun 18", group: "portraits", country: "Germany", source: "dropbox", project: "travel" },
    p4: { time: "06-19 17:00", day: "Jun 19", group: "portraits", country: "Sweden", source: "gdrive", project: "travel" },
    p5: { time: "06-17 19:00", day: "Jun 17", group: "portraits", country: "Spain", source: "icloud", project: "travel" },
    ae1: { time: "06-16 14:00", day: "Jun 16", group: "aerial", country: "Ukraine", source: "gdrive", project: "travel" },
    ae2: { time: "06-17 11:00", day: "Jun 17", group: "aerial", country: "France", source: "gdrive", project: "travel" },
    ae3: { time: "06-19 09:00", day: "Jun 19", group: "aerial", country: "Sweden", source: "icloud", project: "travel" },
    ae4: { time: "06-18 08:00", day: "Jun 18", group: "aerial", country: "Germany", source: "icloud", project: "travel" },
    ae5: { time: "06-16 20:00", day: "Jun 16", group: "aerial", country: "United Kingdom", source: "icloud", project: "travel" },
    nt1: { time: "06-16 22:00", day: "Jun 16", group: "night", country: "United Kingdom", source: "dropbox", project: "client" },
    nt2: { time: "06-17 21:30", day: "Jun 17", group: "night", country: "Ukraine", source: "gdrive", project: "client" },
    nt3: { time: "06-18 20:00", day: "Jun 18", group: "night", country: "Italy", source: "icloud", project: "client" },
    nt4: { time: "06-17 22:00", day: "Jun 17", group: "night", country: "France", source: "gdrive", project: "client" },
    nt5: { time: "06-19 21:00", day: "Jun 19", group: "night", country: "Poland", source: "dropbox", project: "client" },
    ar1: { time: "06-16 07:00", day: "Jun 16", group: "archive", country: "Spain", source: "dropbox", project: "client" },
    ar2: { time: "06-17 06:30", day: "Jun 17", group: "archive", country: "France", source: "dropbox", project: "client" },
    ar3: { time: "06-19 16:00", day: "Jun 19", group: "archive", country: "Ukraine", source: "gdrive", project: "client" },
    ar4: { time: "06-16 17:00", day: "Jun 16", group: "archive", country: "Italy", source: "dropbox", project: "client" },
    r1: { time: "06-16 09:00", day: "Jun 16", group: "rescue", country: "Ukraine", source: "gdrive", project: "travel" },
    r2: { time: "06-19 14:00", day: "Jun 19", group: "rescue", country: "Ukraine", source: "icloud", project: "client" },
    s1: { time: "06-16 16:00", day: "Jun 16", group: "street", country: "Germany", source: "dropbox", project: "travel" },
    s2: { time: "06-18 10:00", day: "Jun 18", group: "street", country: "Sweden", source: "icloud", project: "client" },
    u1: { time: "06-17 13:00", day: "Jun 17", group: "urban", country: "Spain", source: "gdrive", project: "travel" },
    u2: { time: "06-19 18:00", day: "Jun 19", group: "urban", country: "Italy", source: "dropbox", project: "client" },
    ai1: { time: "06-16 10:00", day: "Jun 16", group: "aid", country: "Poland", source: "icloud", project: "travel" },
    ai2: { time: "06-18 16:00", day: "Jun 18", group: "aid", country: "United Kingdom", source: "gdrive", project: "client" },
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
    P("p1", "am-port1", 210, 268, 1320, 180), P("p2", "am-port2", 196, 254, 1480, 360), P("p3", "am-port3", 220, 280, 1620, 160),
    P("p4", "am-port4", 208, 264, 1760, 310), P("p5", "am-port5", 200, 260, 1440, 540),
    P("ae1", "am-air1", 248, 166, 1840, 400), P("ae2", "am-air2", 268, 178, 1980, 210), P("ae3", "am-air3", 256, 172, 2120, 390),
    P("ae4", "am-air4", 242, 162, 2260, 190), P("ae5", "am-air5", 260, 174, 2380, 430),
    P("nt1", "am-nt1", 236, 300, 1340, 710), P("nt2", "am-nt2", 260, 174, 1480, 610), P("nt3", "am-nt3", 244, 164, 1640, 770),
    P("nt4", "am-nt4", 252, 168, 1780, 670), P("nt5", "am-nt5", 240, 160, 1920, 830),
    P("ar1", "am-arc1", 232, 156, 1360, 990), P("ar2", "am-arc2", 250, 336, 1520, 870), P("ar3", "am-arc3", 216, 146, 1660, 1040),
    P("ar4", "am-arc4", 238, 160, 1800, 940),
    P("r1", "am-res1", 264, 176, 160, 650), P("r2", "am-res2", 248, 166, 380, 760),
    P("s1", "am-str1", 230, 154, 580, 910), P("s2", "am-str2", 218, 292, 780, 750),
    P("u1", "am-urb1", 254, 170, 980, 650), P("u2", "am-urb2", 242, 162, 1140, 800),
    P("ai1", "am-aid1", 226, 152, 500, 110), P("ai2", "am-aid2", 240, 160, 720, 70),
  ].concat(
    (() => {
      // synthetic bulk content — 5x the hand-authored set, to stress-test real-world volume
      const GROUPS_: PhotoGroup[] = ["rescue", "aid", "urban", "street", "portraits", "aerial", "night", "archive"];
      const COUNTRIES_ = ["Ukraine", "Poland", "Germany", "France", "United Kingdom", "Sweden", "Italy", "Spain"];
      const SOURCES_: PhotoSource[] = ["gdrive", "icloud", "dropbox"];
      const PROJECTS_: ProjectKey[] = ["frontline", "travel", "client"];
      const SIZES_ = [[220, 150], [200, 260], [240, 160], [210, 280], [260, 170], [190, 240]];
      const extra: RawPhoto[] = [];
      const N = 195;
      for (let i = 0; i < N; i++) {
        const sz = SIZES_[i % SIZES_.length];
        extra.push(
          P("syn" + i, "am-syn" + i, sz[0], sz[1], 0, 0, {
            group: GROUPS_[i % GROUPS_.length],
            country: COUNTRIES_[(i * 3 + 1) % COUNTRIES_.length],
            source: SOURCES_[(i * 7) % SOURCES_.length],
            project: PROJECTS_[(i * 5 + 2) % PROJECTS_.length],
          }),
        );
      }
      return extra;
    })(),
  ).map((p) => {
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
    source: p.source as PhotoSource,
    folder: SOURCE_FOLDERS[p.source as PhotoSource][hashId(p.id) % SOURCE_FOLDERS[p.source as PhotoSource].length],
    project: p.project as ProjectKey,
    exif: { ...EXIF_BLOCK },
  }));
}

/** The full mock archive — 235 photos, generated once at module load. */
export const PHOTOS: Photo[] = generatePhotos();

/** Project records for the mock API seam. */
export const PROJECTS: Project[] = (Object.keys(PROJECTS_META) as ProjectKey[]).map((key) => ({
  key,
  label: PROJECTS_META[key].label,
  color: PROJECTS_META[key].color,
  count: PHOTOS.filter((p) => p.project === key).length,
}));

export const GROUP_LIST: GroupMeta[] = Object.values(GROUPS);
export const SOURCE_LIST: SourceMeta[] = Object.values(SOURCES);
