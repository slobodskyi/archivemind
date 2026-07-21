import { NextResponse } from "next/server";
import {
  assetKindFromMime,
  importRequestSchema,
  ingestJobPayloadSchema,
  mimeFromFilename,
  type ImportResponse,
} from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** POST /api/imports (spec §9): cloud-picked files → assets + files rows →
 *  ONE ingest job. Two providers, one core:
 *  - gdrive (ADR 0025): needs the caller's OWN connection; r2_key stays null,
 *    the worker streams bytes via the stored refresh token.
 *  - dropbox (ADR 0008): connection-less; the ~4 h Chooser direct links ride
 *    in the job payload and the worker fetches each once into R2.
 *  Every insert runs under the caller's RLS, mirroring uploads/complete.
 *
 *  Dedup semantics (reviewed): a re-pick of an already-imported file is not
 *  re-created — an ACTIVE duplicate is linked into the project (M:N, ADR
 *  0011), a soft-deleted/source_missing one is REACTIVATED and re-ingested;
 *  silent skips are how photos "vanish". */

interface NormItem {
  key: string; // provider-stable file id → files.source_file_id (dedupe key)
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  link?: string; // dropbox only
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = importRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const data = parsed.data;
  const { projectId } = data;

  // gdrive: the connection must be the CALLER'S OWN (user_id check, not just
  // workspace membership) — connections are personal grants, and without this
  // any editor could exercise another member's refresh token (ADR 0025).
  let connectionId: string | null = null;
  if (data.provider === "gdrive") {
    const { data: connRows, error: connErr } = await supabase
      .from("source_connections")
      .select("id, user_id, status, provider")
      .eq("id", data.connectionId)
      .eq("workspace_id", workspaceId);
    if (connErr) return NextResponse.json({ error: "drive_connect_failed" }, { status: 500 });
    const conn = connRows?.[0];
    if (!conn || conn.provider !== "gdrive" || conn.user_id !== user.id) {
      return NextResponse.json({ error: "drive_not_connected" }, { status: 403 });
    }
    if (conn.status !== "active") {
      return NextResponse.json({ error: "drive_connection_revoked" }, { status: 409 });
    }
    connectionId = conn.id as string;
  }

  // Cheap backlog guard (rate-limit in spirit): the schema already caps 500
  // items/request; refuse to stack unbounded ingest work per workspace.
  const { count: queued } = await supabase
    .from("ai_jobs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("type", "ingest")
    .in("status", ["queued", "running"]);
  if ((queued ?? 0) > 25) {
    return NextResponse.json({ error: "import_backlog" }, { status: 429 });
  }

  const items: NormItem[] =
    data.provider === "gdrive"
      ? data.items.map((i) => ({
          key: i.fileId,
          name: i.name,
          mimeType: i.mimeType,
          sizeBytes: i.sizeBytes ?? null,
        }))
      : data.items.map((i) => ({
          key: i.sourceId,
          name: i.name,
          mimeType: mimeFromFilename(i.name),
          sizeBytes: i.sizeBytes ?? null,
          link: i.link,
        }));
  const itemByKey = new Map(items.map((i) => [i.key, i]));

  // Pre-dedupe on the provider-stable file id. gdrive keys are scoped to the
  // caller's connection; dropbox keys are workspace-wide (no connection —
  // the same Chooser file picked by two members IS the same file). A unique
  // index on the pair is the schema: issue #102; until then the worker's
  // content-hash dedup backstops the narrow concurrent race.
  // workspace_id anchor is load-bearing: RLS scopes this select to every
  // workspace the CALLER can see, and a dual-membership caller would
  // otherwise dedupe against (and link/revive!) another workspace's assets.
  const dedupeQuery = supabase
    .from("files")
    .select("source_file_id, asset_id, assets!inner ( status )")
    .eq("workspace_id", workspaceId)
    .in("source_file_id", [...itemByKey.keys()]);
  const { data: existing, error: exErr } =
    data.provider === "gdrive"
      ? await dedupeQuery.eq("source_connection_id", connectionId)
      : await dedupeQuery.eq("origin", "dropbox").is("source_connection_id", null);
  if (exErr) return NextResponse.json({ error: "drive_import_failed" }, { status: 500 });
  type ExistingRow = { source_file_id: string; asset_id: string; assets: { status: string } };
  const existingRows = (existing ?? []) as unknown as ExistingRow[];
  const existingByFileId = new Map(existingRows.map((f) => [f.source_file_id, f]));

  const fresh = items.filter((i) => !existingByFileId.has(i.key));
  const dupRows = [...new Map(
    items
      .filter((i) => existingByFileId.has(i.key))
      .map((i) => existingByFileId.get(i.key) as ExistingRow)
      .map((r) => [r.asset_id, r]),
  ).values()];
  const activeDupIds = dupRows.filter((r) => r.assets.status === "active").map((r) => r.asset_id);
  // A re-pick of a soft-deleted or source_missing asset is an explicit "I want
  // this back": reactivate it and re-run ingest (the worker's resume guard
  // makes that cheap when previews already exist). Leaving it out of the map
  // instead would create a second files row for the same cloud file, whose
  // content-hash dedup would then merge it back into the dead asset — the
  // silent-vanish loop this branch exists to break.
  const revivedRows = dupRows.filter((r) => r.assets.status !== "active");
  const revivedIds = revivedRows.map((r) => r.asset_id);
  if (revivedIds.length > 0) {
    const { error: reviveErr } = await supabase
      .from("assets")
      .update({ status: "active" })
      .in("id", revivedIds);
    if (reviveErr) {
      console.error("imports: revive failed:", reviveErr.message);
      return NextResponse.json({ error: "drive_import_failed" }, { status: 500 });
    }
  }

  let linkedExisting = 0;
  const dupAssetIds = [...activeDupIds, ...revivedIds];
  if (projectId && dupAssetIds.length > 0) {
    const { error: linkDupErr } = await supabase
      .from("project_assets")
      .upsert(
        dupAssetIds.map((assetId) => ({ project_id: projectId, asset_id: assetId, added_by: user.id })),
        { onConflict: "project_id,asset_id", ignoreDuplicates: true },
      );
    if (linkDupErr) {
      console.error("imports: dup link failed:", linkDupErr.message);
      return NextResponse.json({ error: "drive_import_failed" }, { status: 500 });
    }
    linkedExisting = dupAssetIds.length;
  }

  let assetIds: string[] = [];
  let jobId: string | null = null;
  const ingestIds: string[] = [...revivedIds];
  if (fresh.length > 0 || revivedIds.length > 0) {
    const { data: assets, error: assetErr } = fresh.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("assets")
          .insert(
            fresh.map((i) => ({
              workspace_id: workspaceId,
              added_by: user.id,
              kind: assetKindFromMime(i.mimeType),
              title: i.name,
            })),
          )
          .select("id");
    if (assetErr) {
      console.error("imports: asset insert failed:", assetErr.message);
      return NextResponse.json({ error: "drive_import_failed" }, { status: 500 });
    }
    assetIds = (assets ?? []).map((a) => a.id as string);
    if (assetIds.length !== fresh.length) {
      return NextResponse.json({ error: "asset insert count mismatch" }, { status: 500 });
    }

    const { error: fileErr } = fresh.length === 0
      ? { error: null }
      : await supabase.from("files").insert(
          fresh.map((i, idx) => ({
            asset_id: assetIds[idx],
            workspace_id: workspaceId,
            origin: data.provider,
            r2_key: null, // gdrive: stays null (§6); dropbox: the worker sets it after the one-time fetch
            source_connection_id: connectionId,
            source_file_id: i.key,
            source_path: null,
            mime_type: i.mimeType,
            byte_size: i.sizeBytes,
          })),
        );
    if (fileErr) {
      console.error("imports: file insert failed:", fileErr.message);
      return NextResponse.json({ error: "drive_import_failed" }, { status: 500 });
    }

    ingestIds.push(...assetIds);
    if (projectId && assetIds.length > 0) {
      const { error: linkErr } = await supabase.from("project_assets").upsert(
        assetIds.map((assetId) => ({ project_id: projectId, asset_id: assetId, added_by: user.id })),
        { onConflict: "project_id,asset_id", ignoreDuplicates: true },
      );
      if (linkErr) {
        console.error("imports: project link failed:", linkErr.message);
        return NextResponse.json({ error: "drive_import_failed" }, { status: 500 });
      }
    }

    // Dropbox: the ~4 h links ride in the payload — fresh assets by insert
    // order, revived ones re-matched through their re-picked item (a revive
    // whose first fetch never completed still needs bytes; ones already in R2
    // just take the worker's r2-backed branch and ignore their link).
    const dropboxLinks =
      data.provider === "dropbox"
        ? [
            ...fresh.map((i, idx) => ({ asset_id: assetIds[idx], link: i.link as string, name: i.name })),
            ...revivedRows.flatMap((r) => {
              const item = itemByKey.get(r.source_file_id);
              return item?.link ? [{ asset_id: r.asset_id, link: item.link, name: item.name }] : [];
            }),
          ]
        : undefined;

    const { data: job, error: jobErr } = await supabase
      .from("ai_jobs")
      .insert({
        workspace_id: workspaceId,
        user_id: user.id,
        type: "ingest",
        payload: ingestJobPayloadSchema.parse({
          asset_ids: ingestIds,
          ...(dropboxLinks && dropboxLinks.length > 0 ? { dropbox: dropboxLinks } : {}),
        }),
        total_items: ingestIds.length,
        done_items: 0,
      })
      .select("id")
      .single();
    if (jobErr) {
      console.error("imports: job insert failed:", jobErr.message);
      return NextResponse.json({ error: "drive_import_failed" }, { status: 500 });
    }
    jobId = job.id as string;
  }

  const body: ImportResponse = {
    assetIds,
    jobId,
    skippedDuplicates: items.length - fresh.length,
    linkedExisting,
  };
  return NextResponse.json(body);
}
