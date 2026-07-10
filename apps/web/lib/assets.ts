import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExifData, Photo } from "@/types";
import { presignGet } from "@/lib/r2";

/** Real assets → the mockup's Photo shape (server-side; RLS-scoped query +
 *  presigned preview URLs). Per the 2026-07-10 product decision the canvas
 *  shows ONLY real files — no mock mixing; the demo archive is issue #42.
 *  Fields the backend doesn't own yet (group/country/project) get inert
 *  defaults until their phases (#17–#21). */

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
  tags: { name: string } | null;
}

interface FactRow {
  text: string;
  status: "confirmed" | "likely" | "needs_check";
}

interface CaptionRow {
  lang: "en" | "uk" | "ru";
  style: "social" | "agency" | "archival";
  text: string;
}

const LANG_KEY = { en: "EN", uk: "UK", ru: "RU" } as const;
const STYLE_KEY = { social: "Social", agency: "Agency", archival: "Archival" } as const;

interface AssetRow {
  id: string;
  title: string | null;
  status: string;
  ai_processed_at: string | null;
  created_at: string;
  asset_previews: PreviewRow[];
  asset_exif: ExifRow | null;
  asset_tags: TagRow[];
  facts: FactRow[];
  captions: CaptionRow[];
}

/** DB fact_status → the mockup's 3-dot FactStatus. */
const FACT_STATUS_MAP = { confirmed: "confirmed", likely: "pending", needs_check: "unknown" } as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function toExifData(e: ExifRow | null, fallbackDate: Date): ExifData {
  const camera = [e?.camera_make, e?.camera_model].filter(Boolean).join(" ") || "—";
  const taken = e?.taken_at ? new Date(e.taken_at) : fallbackDate;
  return {
    camera,
    lens: e?.lens ?? "—",
    dateTaken: `${taken.getFullYear()}-${pad(taken.getMonth() + 1)}-${pad(taken.getDate())} ${pad(taken.getHours())}:${pad(taken.getMinutes())}`,
    gpsLat: e?.gps_lat ?? 0,
    gpsLon: e?.gps_lon ?? 0,
    gpsLabel: e?.gps_label ?? "",
    iso: e?.iso ?? 0,
    aperture: e?.aperture ?? "—",
    shutter: e?.shutter ?? "—",
  };
}

async function toPhoto(a: AssetRow): Promise<Photo> {
  const thumb = a.asset_previews.find((p) => p.size === "thumb");
  const medium = a.asset_previews.find((p) => p.size === "medium");
  const [src, srcMedium] = await Promise.all([
    thumb ? presignGet(thumb.r2_key) : Promise.resolve(undefined),
    medium ? presignGet(medium.r2_key) : Promise.resolve(undefined),
  ]);

  // Tile aspect basis from the thumb; the mock's w/h are ~64–96px display units.
  const aspect = thumb?.width && thumb?.height ? thumb.width / thumb.height : 4 / 3;
  const w = Math.max(56, Math.min(112, Math.round(76 * Math.sqrt(aspect))));
  const h = Math.max(48, Math.min(112, Math.round(w / aspect)));

  const created = new Date(a.created_at);
  const takenAt = a.asset_exif?.taken_at ? new Date(a.asset_exif.taken_at) : created;

  const processed = a.ai_processed_at != null;
  const tagNames = a.asset_tags.map((t) => t.tags?.name).filter((n): n is string => Boolean(n));
  const captionTexts = Object.fromEntries(
    a.captions.map((c) => [`${LANG_KEY[c.lang]}:${STYLE_KEY[c.style]}`, c.text]),
  );
  const facts =
    a.facts.length > 0
      ? a.facts.map((f) => ({ text: f.text, status: FACT_STATUS_MAP[f.status] }))
      : processed
        ? []
        : [{ text: "Analyze to extract facts", status: "unknown" as const }];

  return {
    id: a.id,
    seed: a.id,
    src,
    srcMedium,
    w,
    h,
    x: 0,
    y: 0,
    filename: a.title ?? "untitled",
    processed,
    status: processed ? "Likely" : "Needs check",
    captionKey: null,
    captionStyle: "Agency",
    chip: null,
    tags: tagNames.length > 0 ? tagNames : null,
    facts,
    captionTexts,
    time: `${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())} ${pad(takenAt.getHours())}:${pad(takenAt.getMinutes())}`,
    day: `${MONTHS[takenAt.getMonth()]} ${takenAt.getDate()}`,
    group: "archive",
    country: "Ukraine",
    source: "upload",
    folder: "Uploads",
    project: "",
    exif: toExifData(a.asset_exif, created),
  };
}

export async function getRealPhotos(supabase: SupabaseClient): Promise<Photo[]> {
  const { data, error } = await supabase
    .from("assets")
    .select(
      `id, title, status, ai_processed_at, created_at,
       asset_previews ( size, r2_key, width, height ),
       asset_exif ( taken_at, camera_make, camera_model, lens, gps_lat, gps_lon, gps_label, iso, aperture, shutter ),
       asset_tags ( tags ( name ) ),
       facts ( text, status ),
       captions ( lang, style, text )`,
    )
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return Promise.all(((data ?? []) as unknown as AssetRow[]).map(toPhoto));
}
