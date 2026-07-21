import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExifData, Photo, PhotoCaptions } from "@/types";
import { presignGet } from "@/lib/r2";
import { UNSORTED_CLOUD_KEY } from "@/lib/layout";
import { deriveTopics } from "@/lib/topics";

/** Real assets → the mockup's Photo shape (server-side; RLS-scoped query +
 *  presigned preview URLs). Per the 2026-07-10 product decision the canvas
 *  shows ONLY real files — no mock mixing; the demo archive is issue #42.
 *  `group` is DERIVED from the asset's AI tags (lib/topics.ts, ADR 0023);
 *  fields the backend doesn't own yet (country/project) keep inert defaults
 *  until their phases (#17–#21). */

interface PreviewRow {
  size: string;
  r2_key: string;
  width: number | null;
  height: number | null;
}

interface ExifRow {
  taken_at: string | null;
  camera_make: string | null;
  camera_model: string | null;
  lens: string | null;
  gps_lat: number | null;
  gps_lon: number | null;
  gps_label: string | null;
  iso: number | null;
  aperture: string | null;
  shutter: string | null;
}

interface TagRow {
  tags: { name: string; category: string } | null;
}

interface FactRow {
  text: string;
  status: "confirmed" | "likely" | "needs_check";
}

interface CaptionDbRow {
  id: string;
  lang: "en" | "uk" | "ru";
  style: "social" | "agency" | "archival";
  text: string;
  is_edited: boolean;
}

interface FileOriginRow {
  origin: string;
  source_path: string | null;
}

interface AssetRow {
  id: string;
  title: string | null;
  status: string;
  ai_processed_at: string | null;
  created_at: string;
  files: FileOriginRow[];
  asset_previews: PreviewRow[];
  asset_exif: ExifRow | null;
  asset_tags: TagRow[];
  facts: FactRow[];
  captions: CaptionDbRow[];
}

/** DB caption enums → the mockup's UI labels. */
const CAPTION_LANG_UP = { en: "EN", uk: "UK", ru: "RU" } as const;
const CAPTION_STYLE_UP = { social: "Social", agency: "Agency", archival: "Archival" } as const;

function toCaptions(rows: CaptionDbRow[]): PhotoCaptions {
  const captions: PhotoCaptions = {};
  for (const c of rows) {
    const lang = CAPTION_LANG_UP[c.lang];
    const style = CAPTION_STYLE_UP[c.style];
    if (!lang || !style) continue; // unknown enum value from a future migration
    (captions[lang] ??= {})[style] = { id: c.id, text: c.text, edited: c.is_edited };
  }
  return captions;
}

/** DB fact_status → the mockup's 3-dot FactStatus. */
const FACT_STATUS_MAP = { confirmed: "confirmed", likely: "pending", needs_check: "unknown" } as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function toExifData(e: ExifRow | null, fallbackDate: Date): ExifData {
  const camera = [e?.camera_make, e?.camera_model].filter(Boolean).join(" ") || "—";
  // Guard unparseable DB values: an invalid taken_at would otherwise format as
  // "NaN-NaN-NaN NaN:NaN" and dump the photo on the Timeline's epoch day.
  const parsed = e?.taken_at ? new Date(e.taken_at) : null;
  const taken = parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallbackDate;
  return {
    camera,
    lens: e?.lens ?? "—",
    dateTaken: `${taken.getFullYear()}-${pad(taken.getMonth() + 1)}-${pad(taken.getDate())} ${pad(taken.getHours())}:${pad(taken.getMinutes())}`,
    gpsLat: e?.gps_lat ?? null,
    gpsLon: e?.gps_lon ?? null,
    gpsLabel: e?.gps_label ?? "",
    iso: e?.iso ?? 0,
    aperture: e?.aperture ?? "—",
    shutter: e?.shutter ?? "—",
  };
}

async function toPhoto(a: AssetRow, topic: string): Promise<Photo> {
  const thumb = a.asset_previews.find((p) => p.size === "thumb");
  // Only the thumb is presigned up front — the canvas renders thumbs. The
  // medium is fetched lazily by the drawer via /api/assets/[id]/medium, which
  // halves the per-load signing work.
  const src = thumb ? await presignGet(thumb.r2_key) : undefined;

  // Tile aspect basis from the thumb; the mock's w/h are ~64–96px display units.
  const aspect = thumb?.width && thumb?.height ? thumb.width / thumb.height : 4 / 3;
  const w = Math.max(56, Math.min(112, Math.round(76 * Math.sqrt(aspect))));
  const h = Math.max(48, Math.min(112, Math.round(w / aspect)));

  const created = new Date(a.created_at);
  const takenAt = a.asset_exif?.taken_at ? new Date(a.asset_exif.taken_at) : created;

  const processed = a.ai_processed_at != null;
  // De-duped: the same tag NAME can be two DB rows (unique key is name+category).
  const tagNames = [...new Set(a.asset_tags.map((t) => t.tags?.name).filter((n): n is string => Boolean(n)))];
  const facts =
    a.facts.length > 0
      ? a.facts.map((f) => ({ text: f.text, status: FACT_STATUS_MAP[f.status] }))
      : processed
        ? []
        : [{ text: "Analyze to extract facts", status: "unknown" as const }];

  // Representative file: assets are 1:N to files by schema, but today every
  // asset has exactly one (dedup merges rather than attaching); [0] is it.
  const origin = a.files[0]?.origin;
  const gdrive = origin === "gdrive";
  const dropbox = origin === "dropbox";

  const photo: Photo = {
    id: a.id,
    seed: a.id,
    src,
    w,
    h,
    x: 0,
    y: 0,
    filename: a.title ?? "untitled",
    processed,
    status: processed ? "Likely" : "Needs check",
    captionKey: null,
    captionStyle: "Agency",
    captions: toCaptions(a.captions),
    chip: null,
    tags: tagNames.length > 0 ? tagNames : null,
    facts,
    time: `${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())} ${pad(takenAt.getHours())}:${pad(takenAt.getMinutes())}`,
    day: `${MONTHS[takenAt.getMonth()]} ${takenAt.getDate()}`,
    group: topic,
    country: "Ukraine",
    source: gdrive ? "gdrive" : dropbox ? "dropbox" : "upload",
    folder: gdrive ? (a.files[0]?.source_path ?? "Google Drive") : dropbox ? "Dropbox" : "Uploads",
    project: "",
    exif: toExifData(a.asset_exif, created),
  };
  return photo;
}

const ASSET_SELECT = `id, title, status, ai_processed_at, created_at,
       files ( origin, source_path ),
       asset_previews ( size, r2_key, width, height ),
       asset_exif ( taken_at, camera_make, camera_model, lens, gps_lat, gps_lon, gps_label, iso, aperture, shutter ),
       asset_tags ( tags ( name, category ) ),
       facts ( text, status ),
       captions ( id, lang, style, text, is_edited )`;

/** The caller's assets (RLS-scoped). `projectId` filters to one project's M:N
 *  membership; omit (or pass "all") for the whole workspace. */
export async function getRealPhotos(supabase: SupabaseClient, projectId?: string): Promise<Photo[]> {
  const scoped = projectId && projectId !== "all";
  // Inner-join through the M:N table so only members of a project return.
  const { data, error } = scoped
    ? await supabase
        .from("assets")
        .select(`${ASSET_SELECT}, project_assets!inner ( project_id )`)
        .eq("status", "active")
        .eq("project_assets.project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(500)
    : await supabase
        .from("assets")
        .select(ASSET_SELECT)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as AssetRow[];
  // Topic clouds are RESULT-SET-relative: sharing counts, the ambient
  // threshold and the top-6 fold are computed over exactly the rows this
  // call returns (one project's newest ≤500, or the workspace window for
  // "all") — the same asset can legitimately carry different topics in
  // different projects (ADR 0023).
  const topics = deriveTopics(
    rows.map((r) => ({
      id: r.id,
      tags: r.asset_tags.flatMap((t) => (t.tags ? [{ name: t.tags.name, category: t.tags.category }] : [])),
    })),
  );
  return Promise.all(rows.map((r) => toPhoto(r, topics.get(r.id) ?? UNSORTED_CLOUD_KEY)));
}
