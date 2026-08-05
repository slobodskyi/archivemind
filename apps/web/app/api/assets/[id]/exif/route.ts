import { NextResponse } from "next/server";
import {
  EXIF_EDITABLE_COLUMNS,
  patchAssetExifRequestSchema,
  uuidSchema,
  type ExifEditableColumn,
  type PatchAssetExifRequest,
} from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** Manual Metadata/EXIF corrections (migration 20260805000001).
 *
 *  PATCH  — apply a correction. Writes asset_exif's own columns, so the fix
 *           reaches the Timeline, the Map, the search RPC and the captions CSV
 *           without any of them knowing an override layer exists.
 *  DELETE — revert every manual correction from the `original_values` snapshot.
 *
 *  RLS (asset_exif_insert / asset_exif_update, both is_editor_of_asset) is the
 *  boundary; the column grant narrows *which* columns even an editor may write,
 *  so a request naming anything outside it fails with 42501 rather than
 *  silently doing nothing. */

/** DB row shape for the columns this route reads and restores. */
type ExifRow = Record<ExifEditableColumn, unknown> & {
  edited_fields: string[] | null;
  original_values: Record<string, unknown> | null;
};

const EDITABLE = new Set<string>(EXIF_EDITABLE_COLUMNS);
const SELECT = `${EXIF_EDITABLE_COLUMNS.join(", ")}, edited_fields, original_values`;

/** The drawer's fields → the table's columns. `camera` is one input on screen
 *  and two columns underneath: the whole typed string goes to `camera_model`
 *  with `camera_make` cleared, because lib/assets.ts renders the pair by joining
 *  them with a space. Splitting on whitespace instead would guess wrong on every
 *  two-word make ("Canon EOS R5" is fine, "Fujifilm X-T5" is fine, "Phase One
 *  IQ4" is not) and round-trip a value the user never typed. */
function toColumns(patch: PatchAssetExifRequest): Partial<Record<ExifEditableColumn, unknown>> {
  const out: Partial<Record<ExifEditableColumn, unknown>> = {};
  // `undefined` means "not mentioned — leave it alone"; `null` is a real edit
  // that clears the field. Only `in` distinguishes the two.
  if ("camera" in patch) {
    out.camera_model = emptyToNull(patch.camera);
    out.camera_make = null;
  }
  if ("lens" in patch) out.lens = emptyToNull(patch.lens);
  if ("takenAt" in patch) out.taken_at = patch.takenAt;
  if ("iso" in patch) out.iso = patch.iso;
  if ("aperture" in patch) out.aperture = emptyToNull(patch.aperture);
  if ("shutter" in patch) out.shutter = emptyToNull(patch.shutter);
  if ("gpsLabel" in patch) out.gps_label = emptyToNull(patch.gpsLabel);
  if ("gpsLat" in patch) {
    out.gps_lat = patch.gpsLat;
    out.gps_lon = patch.gpsLon;
    // The coordinates stopped coming from the file's GPS the moment a person
    // typed them. init.sql anticipated exactly this value ("'gps' | 'manual' |
    // 'ai'"); clearing the pair returns the column to null, not to 'gps'.
    out.location_source = patch.gpsLat == null ? null : "manual";
  }
  return out;
}

/** The drawer renders a missing value as "—" and an emptied input as "". Both
 *  mean "no value", and storing either literally would make the em dash show up
 *  inside the input on the next open, and export as if it were a camera name. */
function emptyToNull(v: string | null | undefined): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed === "" || trimmed === "—" ? null : trimmed;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid asset id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = patchAssetExifRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  // The asset must be visible to the caller and still active — correcting the
  // metadata of a trashed photo would write a row the purge job is about to
  // erase. RLS scopes the read to the caller's workspace.
  const { data: asset, error: assetErr } = await supabase
    .from("assets")
    .select("id")
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();
  if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 });
  if (!asset) return NextResponse.json({ error: "asset not found" }, { status: 404 });

  const columns = toColumns(parsed.data);
  const touched = Object.keys(columns) as ExifEditableColumn[];
  if (touched.length === 0) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  // A file whose EXIF extraction found nothing has no row at all (ingest only
  // inserts when extractExif returned something), and "type the camera in by
  // hand" has to work there most of all — so a missing row is an insert, not a
  // 404. `raw` and `focal_length` stay null: nothing was ever extracted.
  const { data: existing, error: readErr } = await supabase
    .from("asset_exif")
    .select(SELECT)
    .eq("asset_id", id)
    .maybeSingle<ExifRow>();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });

  const wasEdited = new Set(existing?.edited_fields ?? []);
  // Snapshot what ingest extracted, but only for columns not already carrying a
  // correction — re-snapshotting on a second edit would quietly redefine "the
  // original" as the previous correction, and Revert would stop reaching the
  // file's own value.
  const originals: Record<string, unknown> = { ...(existing?.original_values ?? {}) };
  for (const col of touched) {
    if (!wasEdited.has(col)) originals[col] = existing ? (existing[col] ?? null) : null;
  }

  const row = {
    ...columns,
    edited_fields: [...new Set([...wasEdited, ...touched])],
    original_values: originals,
  };

  const { error: writeErr } = existing
    ? await supabase.from("asset_exif").update(row).eq("asset_id", id)
    : await supabase.from("asset_exif").insert({ asset_id: id, ...row });
  if (writeErr) {
    // 42501 = the column grant refused a column outside the editable list. That
    // is a bug in this route rather than a caller error, so it must not be
    // reported as a 400 the client is expected to fix.
    const status = writeErr.code === "42501" ? 403 : 500;
    return NextResponse.json({ error: writeErr.message }, { status });
  }

  return NextResponse.json({ ok: true, editedFields: row.edited_fields });
}

/** Revert every manual correction: restore the snapshot and drop the flags. All
 *  or nothing, matching the drawer's single Revert control — a per-field undo
 *  would need per-field UI that the editor deliberately doesn't have. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid asset id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: existing, error: readErr } = await supabase
    .from("asset_exif")
    .select("edited_fields, original_values")
    .eq("asset_id", id)
    .maybeSingle<Pick<ExifRow, "edited_fields" | "original_values">>();
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  // Nothing to revert is success, not an error — the drawer only offers Revert
  // when it believes there are edits, and a stale view shouldn't raise.
  if (!existing || (existing.edited_fields ?? []).length === 0) {
    return NextResponse.json({ ok: true, reverted: 0 });
  }

  const snapshot = existing.original_values ?? {};
  const restore: Record<string, unknown> = { edited_fields: [], original_values: {} };
  // Restore only what this route is allowed to write. A key outside the list
  // could only get into the snapshot by someone hand-editing the JSON, and
  // sending it on would earn a 42501 for the whole revert.
  for (const [col, value] of Object.entries(snapshot)) {
    if (EDITABLE.has(col)) restore[col] = value;
  }
  // A column edited before the snapshot existed has no entry to restore; the
  // file's value for it is unrecoverable here, so clear it rather than leave the
  // correction standing while the UI reports the photo as reverted.
  for (const col of existing.edited_fields ?? []) {
    if (EDITABLE.has(col) && !(col in snapshot)) restore[col] = null;
  }

  const { error: writeErr } = await supabase.from("asset_exif").update(restore).eq("asset_id", id);
  if (writeErr) {
    const status = writeErr.code === "42501" ? 403 : 500;
    return NextResponse.json({ error: writeErr.message }, { status });
  }

  return NextResponse.json({ ok: true, reverted: (existing.edited_fields ?? []).length });
}
