import type { SupabaseClient } from "@supabase/supabase-js";
import {
  editRecipeSchema,
  resolveCropRect,
  workingDimensions,
  type AssetLabel,
  type TrashedAsset,
} from "@archivemind/shared";
import type { ExifData, Photo, PhotoCaptions } from "../types";
import { presignGet } from "./r2";
import {
  deriveTopicAssignments,
  heuristicTopicKey,
  UNSORTED_CLOUD_KEY,
  type TopicAssignment,
} from "./topics";

/** Real assets → the mockup's Photo shape (server-side; RLS-scoped query +
 *  presigned preview URLs). Per the 2026-07-10 product decision the canvas
 *  shows ONLY real files — no mock mixing; the demo archive is issue #42.
 *  Topic identity/label come from the manual-first read model in lib/topics.ts:
 *  an explicit override wins, then the stored embedding cluster (ADR 0028),
 *  then the tag heuristic (ADR 0023). Inert country/project defaults survive
 *  only for retired mockup fields that no current view reads. */

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
  /** Columns a human corrected by hand (migration 20260805000001). */
  edited_fields: string[] | null;
}

interface TagRow {
  tags: { name: string; category: string } | null;
}

interface FactRow {
  id: string;
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

/** A non-destructive edit (ADR 0030). To-one (asset_edits.asset_id is its PK),
 *  so Supabase embeds it as an object|null — same shape as asset_exif. */
interface AssetEditRow {
  recipe: unknown;
  edited_thumb_key: string | null;
  edited_medium_key: string | null;
}

/** One-to-one user override (`asset_id` is the table PK), with its target
 *  topic embedded through the override's `cluster_id` FK. */
interface TopicClusterOverrideRow {
  cluster_id: string;
  topic_clusters: { label: string } | null;
}

interface AssetRow {
  id: string;
  title: string | null;
  status: string;
  ai_processed_at: string | null;
  created_at: string;
  label?: AssetLabel | null;
  cluster_id: string | null;
  topic_clusters: { label: string } | null;
  topic_cluster_overrides?: TopicClusterOverrideRow | null;
  files: FileOriginRow[];
  asset_previews: PreviewRow[];
  asset_exif: ExifRow | null;
  asset_edits: AssetEditRow | null;
  asset_tags: TagRow[];
  facts: FactRow[];
  captions: CaptionDbRow[];
}

/** The bounded set mounted by today's non-virtualized canvas, plus the exact
 *  number of matching rows. The total keeps the performance guard honest: a
 *  larger archive is never mistaken for files that failed to upload. */
export interface PhotoWindow {
  photos: Photo[];
  total: number;
}

export const CANVAS_ASSET_LIMIT = 500;

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
    editedFields: e?.edited_fields ?? [],
    // The absolute instant behind the display string above. `dateTaken` is
    // formatted in the server's local time and cannot be parsed back without
    // guessing a zone, so the editor needs the raw value. Null when taken_at was
    // missing and `taken` fell back to created_at — the editor then starts empty
    // rather than offering the ingest date as if the camera had recorded it.
    takenAtIso: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
  };
}

async function toPhoto(a: AssetRow, topic: TopicAssignment): Promise<Photo> {
  const thumb = a.asset_previews.find((p) => p.size === "thumb");
  // A non-destructive edit (ADR 0030) redirects src to the edited thumb; the
  // originals in asset_previews are left untouched (a reset just drops the row).
  const edit = a.asset_edits;
  const edited = Boolean(edit);
  const thumbKey = edit?.edited_thumb_key ?? thumb?.r2_key;
  // Only the thumb is presigned up front — the canvas renders thumbs. The
  // medium is fetched lazily by the drawer via /api/assets/[id]/medium, which
  // halves the per-load signing work.
  const src = thumbKey ? await presignGet(thumbKey) : undefined;

  // Tile aspect basis from the thumb; the mock's w/h are ~64–96px display units.
  // The edited thumb carries no stored dims, but the recipe + the original thumb
  // dims resolve its shape (a rotate90 swaps the tile, a crop reshapes it), so
  // the tile matches what the edit actually renders.
  let aspect = thumb?.width && thumb?.height ? thumb.width / thumb.height : 4 / 3;
  if (edit && thumb?.width && thumb?.height) {
    const parsed = editRecipeSchema.safeParse(edit.recipe);
    if (parsed.success) {
      const work = workingDimensions(thumb.width, thumb.height, parsed.data);
      const rect = resolveCropRect(work.w, work.h, parsed.data.crop);
      if (rect.width > 0 && rect.height > 0) aspect = rect.width / rect.height;
    }
  }
  const w = Math.max(56, Math.min(112, Math.round(76 * Math.sqrt(aspect))));
  const h = Math.max(48, Math.min(112, Math.round(w / aspect)));

  const created = new Date(a.created_at);
  const takenAt = a.asset_exif?.taken_at ? new Date(a.asset_exif.taken_at) : created;

  const processed = a.ai_processed_at != null;
  // De-duped: the same tag NAME can be two DB rows (unique key is name+category).
  const tagNames = [...new Set(a.asset_tags.map((t) => t.tags?.name).filter((n): n is string => Boolean(n)))];
  const facts =
    a.facts.length > 0
      ? a.facts.map((f) => ({ id: f.id, text: f.text, status: FACT_STATUS_MAP[f.status] }))
      : processed
        ? []
        // Placeholder, not a row — null id keeps it out of the confirm flow.
        : [{ id: null, text: "Analyze to extract facts", status: "unknown" as const }];

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
    group: topic.label,
    // Keep the machine baseline and the user override side-by-side. The
    // effective key/id are precomputed so every client consumer uses the same
    // manual-first rule and the same synthetic fallback keys.
    autoClusterId: topic.autoClusterId,
    manualClusterId: topic.manualClusterId,
    autoTopicKey: topic.autoTopicKey,
    autoTopicLabel: topic.autoTopicLabel,
    topicId: topic.topicId,
    topicKey: topic.topicKey,
    country: "Ukraine",
    // `label ?? null` rather than `a.label`: the pre-migration fallback select
    // omits the column entirely, and an undefined there would read as "not
    // loaded" further up where null means "not labelled".
    label: a.label ?? null,
    source: gdrive ? "gdrive" : dropbox ? "dropbox" : "upload",
    edited,
    folder: gdrive ? (a.files[0]?.source_path ?? "Google Drive") : dropbox ? "Dropbox" : "Uploads",
    project: "",
    exif: toExifData(a.asset_exif, created),
  };
  return photo;
}

/** Relations/columns that predate editable Topic. */
const ASSET_SELECT_BASE = `id, title, status, ai_processed_at, created_at, cluster_id,
       topic_clusters ( label ),
       files ( origin, source_path ),
       asset_previews ( size, r2_key, width, height ),
       asset_edits ( recipe, edited_thumb_key, edited_medium_key ),
       asset_exif ( taken_at, camera_make, camera_model, lens, gps_lat, gps_lon, gps_label, iso, aperture, shutter, edited_fields ),
       asset_tags ( tags ( name, category ) ),
       facts ( id, text, status ),
       captions ( id, lang, style, text, is_edited )`;

/** New one-to-one manual membership relation. Kept as a select fragment so a
 *  web-before-migration deploy can retry without it. */
const TOPIC_OVERRIDE_SELECT = `topic_cluster_overrides ( cluster_id, topic_clusters ( label ) )`;

function assetSelect(includeLabel: boolean, includeTopicOverrides: boolean): string {
  return [includeLabel ? "label" : null, includeTopicOverrides ? TOPIC_OVERRIDE_SELECT : null, ASSET_SELECT_BASE]
    .filter((part): part is string => part !== null)
    .join(", ");
}

/** The caller's trashed photos (ADR 0033) — the photo half of the Trash view,
 *  read by GET /api/assets?scope=trash. Un-purged trash only: a purged
 *  tombstone has nothing left to show or restore, so it simply leaves the
 *  list. The edited thumb wins when present, matching the canvas. */
export async function getTrashedAssets(supabase: SupabaseClient): Promise<TrashedAsset[]> {
  const { data, error } = await supabase
    .from("assets")
    .select(
      `id, title, deleted_at,
       asset_previews ( size, r2_key ),
       asset_edits ( edited_thumb_key )`,
    )
    .eq("status", "deleted")
    .is("purged_at", null)
    .order("deleted_at", { ascending: false, nullsFirst: false })
    .limit(500);
  // Trash-retention migration (20260723000001) not applied yet — degrade to an
  // empty Trash rather than a hard crash, same posture as getProjectCards.
  if (error?.code === "42703") return [];
  if (error) throw error;

  interface Row {
    id: string;
    title: string | null;
    deleted_at: string | null;
    asset_previews: { size: string; r2_key: string }[];
    asset_edits: { edited_thumb_key: string | null } | null;
  }
  const rows = (data ?? []) as unknown as Row[];
  return Promise.all(
    rows.map(async (r) => {
      const thumbKey =
        r.asset_edits?.edited_thumb_key ?? r.asset_previews.find((p) => p.size === "thumb")?.r2_key;
      return {
        id: r.id,
        name: r.title ?? "untitled",
        thumb: thumbKey ? await presignGet(thumbKey) : null,
        deletedAt: r.deleted_at,
      };
    }),
  );
}

/** One canvas read, parameterised by the select list so the caller can retry
 *  with a narrower one. Inner-joins through the M:N table when scoped, so only
 *  members of a project return. */
function selectAssets(supabase: SupabaseClient, projectId: string | undefined, select: string) {
  const scoped = projectId && projectId !== "all";
  const query = scoped
    ? supabase
        .from("assets")
        .select(`${select}, project_assets!inner ( project_id )`, { count: "exact" })
        .eq("project_assets.project_id", projectId)
    : supabase.from("assets").select(select, { count: "exact" });
  return query
    .eq("status", "active")
    .order("created_at", { ascending: false })
    // A deterministic tie-breaker matters for any later cursor/range paging:
    // one upload batch can create many rows with the same timestamp.
    .order("id", { ascending: false })
    // PostgREST ranges are inclusive. Keep every request below Supabase's own
    // max_rows guard while exposing the exact count alongside this window.
    .range(0, CANVAS_ASSET_LIMIT - 1);
}

function isMissingTopicOverrideRelation(error: {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}): boolean {
  if (error.code === "42P01") return true;
  if (error.code !== "PGRST200" && error.code !== "PGRST204") return false;
  return [error.message, error.details, error.hint].some((part) => part?.includes("topic_cluster_overrides"));
}

/** The caller's newest canvas window (RLS-scoped) and exact matching row count.
 *  `projectId` filters to one project's M:N membership; omit (or pass "all")
 *  for the whole workspace. */
export async function getRealPhotoWindow(supabase: SupabaseClient, projectId?: string): Promise<PhotoWindow> {
  let includeLabel = true;
  let includeTopicOverrides = true;
  let { data, error, count } = await selectAssets(
    supabase,
    projectId,
    assetSelect(includeLabel, includeTopicOverrides),
  );
  // The color-label column and editable-Topic relation can each deploy after
  // this web read. Peel off only the unavailable feature and retry, so either
  // migration gap degrades to the previous behavior instead of blanking the
  // ONE query the canvas is made of.
  for (let retry = 0; error && retry < 2; retry += 1) {
    if (error.code === "42703" && includeLabel) {
      includeLabel = false;
    } else if (includeTopicOverrides && isMissingTopicOverrideRelation(error)) {
      includeTopicOverrides = false;
    } else {
      break;
    }
    ({ data, error, count } = await selectAssets(
      supabase,
      projectId,
      assetSelect(includeLabel, includeTopicOverrides),
    ));
  }
  if (error) throw error;
  const rows = (data ?? []) as unknown as AssetRow[];
  // Preserve the AI baseline even when a manual target wins. Both target labels
  // are RLS-scoped joins, while heuristic fallback remains result-set-relative
  // over exactly the rows this call returned (ADR 0023).
  const topics = deriveTopicAssignments(
    rows.map((r) => ({
      id: r.id,
      autoClusterId: r.cluster_id,
      autoClusterLabel: r.topic_clusters?.label ?? null,
      manualClusterId: r.topic_cluster_overrides?.cluster_id ?? null,
      manualClusterLabel: r.topic_cluster_overrides?.topic_clusters?.label ?? null,
      tags: r.asset_tags.flatMap((t) => (t.tags ? [{ name: t.tags.name, category: t.tags.category }] : [])),
    })),
  );
  const fallbackKey = heuristicTopicKey(UNSORTED_CLOUD_KEY);
  const fallbackTopic: TopicAssignment = {
    autoClusterId: null,
    manualClusterId: null,
    autoTopicKey: fallbackKey,
    autoTopicLabel: UNSORTED_CLOUD_KEY,
    topicId: null,
    topicKey: fallbackKey,
    label: UNSORTED_CLOUD_KEY,
  };
  const photos = await Promise.all(rows.map((r) => toPhoto(r, topics.get(r.id) ?? fallbackTopic)));
  // Exact count can be null when a non-PostgREST test double or future backend
  // omits Content-Range. Never report fewer rows than we actually mapped.
  return { photos, total: Math.max(count ?? rows.length, rows.length) };
}

/** Backward-compatible photo-only reader for callers that do not need to
 *  surface whether the canvas window is truncated. */
export async function getRealPhotos(supabase: SupabaseClient, projectId?: string): Promise<Photo[]> {
  return (await getRealPhotoWindow(supabase, projectId)).photos;
}
