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
}

/** DB fact_status → the mockup's 3-dot FactStatus. */
const FACT_STATUS_MAP = { confirmed: "confirmed", likely: "pending", needs_check: "unknown" } as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/* ─────────────────────────────────────────────────────────────────────────
 * TEMP demo scaffold (edit #2) — ⚠️ SET BACK TO false / REMOVE BEFORE MERGE.
 * On today's uniform real data every asset is Ukraine / archive / same-ish
 * month, so Map/Topic/Timeline each render a single cloud. Flipping this on
 * spreads assets deterministically across a few countries, topics and months
 * so the multi-cloud layout is visible while we test. This must NOT reach
 * production — the real fields land with their own backend phase (ADR 0018).
 * (Wanted this behind an env flag, but .env.local isn't writable here.)
 * ──────────────────────────────────────────────────────────────────────── */
const DEMO_CLOUDS = true;
const DEMO_COUNTRIES = ["Ukraine", "Poland", "Italy"];
const DEMO_GROUPS = ["rescue", "aid", "urban"] as const;
const DEMO_MONTHS = [3, 4, 6]; // Apr / May / Jul 2026 (0-indexed)

function demoHash(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h;
}

function diversifyForDemo(photo: Photo): Photo {
  if (!DEMO_CLOUDS) return photo;
  const h = demoHash(photo.id);
  const month = DEMO_MONTHS[(h >>> 6) % DEMO_MONTHS.length];
  const day = ((h >>> 9) % 27) + 1;
  return {
    ...photo,
    country: DEMO_COUNTRIES[h % DEMO_COUNTRIES.length],
    group: DEMO_GROUPS[(h >>> 3) % DEMO_GROUPS.length],
    time: `${pad(month + 1)}-${pad(day)} 12:00`,
    day: `${MONTHS[month]} ${day}`,
    exif: { ...photo.exif, dateTaken: `2026-${pad(month + 1)}-${pad(day)} 12:00` },
  };
}

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
  const tagNames = a.asset_tags.map((t) => t.tags?.name).filter((n): n is string => Boolean(n));
  const facts =
    a.facts.length > 0
      ? a.facts.map((f) => ({ text: f.text, status: FACT_STATUS_MAP[f.status] }))
      : processed
        ? []
        : [{ text: "Analyze to extract facts", status: "unknown" as const }];

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
    chip: null,
    tags: tagNames.length > 0 ? tagNames : null,
    facts,
    time: `${pad(takenAt.getMonth() + 1)}-${pad(takenAt.getDate())} ${pad(takenAt.getHours())}:${pad(takenAt.getMinutes())}`,
    day: `${MONTHS[takenAt.getMonth()]} ${takenAt.getDate()}`,
    group: "archive",
    country: "Ukraine",
    source: "upload",
    folder: "Uploads",
    project: "",
    exif: toExifData(a.asset_exif, created),
  };
  return diversifyForDemo(photo);
}

const ASSET_SELECT = `id, title, status, ai_processed_at, created_at,
       asset_previews ( size, r2_key, width, height ),
       asset_exif ( taken_at, camera_make, camera_model, lens, gps_lat, gps_lon, gps_label, iso, aperture, shutter ),
       asset_tags ( tags ( name ) ),
       facts ( text, status )`;

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
  return Promise.all(((data ?? []) as unknown as AssetRow[]).map(toPhoto));
}
