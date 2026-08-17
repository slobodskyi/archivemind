import {
  ONEDRIVE_EXPAND_BATCH,
  ONEDRIVE_MAX_DEPTH,
  ONEDRIVE_MAX_ITEMS_PER_IMPORT,
  assetKindFromMime,
  mimeFromFilename,
  type OneDriveExpand,
} from "@archivemind/shared";
import type pg from "pg";
import {
  OneDriveFileError,
  ThrottleGate,
  listOneDriveChildren,
  type OneDriveItem,
} from "../services/onedrive";

/** Folder expansion — the capability that justifies OneDrive existing beside
 *  Drive (ADR 0047 §1). `drive.file` cannot expand a picked folder, so Drive
 *  import makes people multi-select thousands of files by hand; delegated
 *  `Files.Read` walks the tree.
 *
 *  It runs in the WORKER, not the import route, because a folder can hold
 *  18,000 items and the route is capped at 500 per request under a serverless
 *  timeout. What it produces is more `ingest` jobs — never one enormous one:
 *
 *   - progress, retries and ADR 0032's error containment are all per-job, so a
 *     single 18,000-item job would make one bad file poison the batch;
 *   - a fanned-out batch is indistinguishable downstream from a hand-picked
 *     import, so nothing else had to learn about folders.
 *
 *  Those child jobs carry `asset_ids` and NO `onedrive_expand`, which is what
 *  makes an expansion incapable of enqueuing another expansion. */

/** A folder walk should bring in photos and documents, not the stray .zip and
 *  .txt that live beside them. Everything else is counted and skipped — the
 *  count is reported, because silently ignoring files is how an import comes
 *  to look like it lost something. */
export function isImportableName(name: string, graphMime: string | null): boolean {
  const kind = assetKindFromMime(resolveMime(name, graphMime));
  return kind === "photo" || kind === "pdf";
}

/** Extension first, Graph second — Graph reports plenty of camera files as
 *  application/octet-stream, and mimeFromFilename is what the upload and
 *  Dropbox paths already key asset kind off. */
export function resolveMime(name: string, graphMime: string | null): string {
  const byName = mimeFromFilename(name);
  return byName !== "application/octet-stream" ? byName : (graphMime ?? byName);
}

/** `parentReference.path` → the human half, for files.source_path. */
export function folderPathOf(item: OneDriveItem): string | null {
  if (!item.path) return null;
  const marker = item.path.indexOf("root:");
  const tail = marker >= 0 ? item.path.slice(marker + "root:".length) : item.path;
  try {
    return decodeURIComponent(tail) || "/";
  } catch {
    return tail || "/";
  }
}

export function chunk<T>(items: T[], size = ONEDRIVE_EXPAND_BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface DiscoveredFile {
  driveId: string;
  itemId: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  path: string | null;
}

export interface ExpandOutcome {
  discovered: DiscoveredFile[];
  skipped: number;
  foldersScanned: number;
}

/** Depth-first walk of every picked folder.
 *
 *  Caps FAIL rather than truncate. A silent cut would read to the user as
 *  "OneDrive only had 5000 photos", which is a worse outcome than an error
 *  naming the limit — so both breaches throw a first-party code. */
export async function walkFolders(input: {
  expand: OneDriveExpand;
  accessToken: string;
  gate: ThrottleGate;
  onProgress?: (foldersScanned: number, filesFound: number, currentName: string) => Promise<void>;
}): Promise<ExpandOutcome> {
  const { expand, accessToken, gate } = input;
  const discovered: DiscoveredFile[] = [];
  let skipped = 0;
  let foldersScanned = 0;

  const stack: { driveId: string; itemId: string; depth: number; name: string }[] = expand.folders.map(
    (f) => ({ driveId: f.drive_id, itemId: f.item_id, depth: 0, name: f.name }),
  );
  // Graph ids are unique per drive; a shortcut loop would otherwise re-walk
  // forever inside the depth budget.
  const seenFolders = new Set(stack.map((f) => `${f.driveId}:${f.itemId}`));

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.depth > ONEDRIVE_MAX_DEPTH) {
      throw new OneDriveFileError("onedrive_too_deep");
    }

    for await (const child of listOneDriveChildren(node.driveId, node.itemId, accessToken, gate)) {
      if (child.isFolder) {
        const key = `${node.driveId}:${child.id}`;
        if (seenFolders.has(key)) continue;
        seenFolders.add(key);
        stack.push({ driveId: node.driveId, itemId: child.id, depth: node.depth + 1, name: child.name });
        continue;
      }
      if (!isImportableName(child.name, child.mimeType)) {
        skipped += 1;
        continue;
      }
      discovered.push({
        driveId: node.driveId,
        itemId: child.id,
        name: child.name,
        mimeType: resolveMime(child.name, child.mimeType),
        sizeBytes: child.size,
        path: folderPathOf(child),
      });
      if (discovered.length > ONEDRIVE_MAX_ITEMS_PER_IMPORT) {
        throw new OneDriveFileError("onedrive_too_many_items");
      }
    }

    foldersScanned += 1;
    // Discovery on a large tree takes minutes. A progress bar that does not
    // move for minutes reads as a hang, so the label names the folder.
    await input.onProgress?.(foldersScanned, discovered.length, node.name);
  }

  return { discovered, skipped, foldersScanned };
}

export interface FanOutResult {
  created: number;
  linkedExisting: number;
  jobIds: string[];
}

/** Turn discovered files into assets + files rows and fan them out into
 *  batched `ingest` jobs. */
export async function fanOutDiscovered(input: {
  pool: pg.Pool;
  workspaceId: string;
  userId: string | null;
  connectionId: string;
  projectId: string | null;
  discovered: DiscoveredFile[];
}): Promise<FanOutResult> {
  const { pool, workspaceId, userId, connectionId, projectId } = input;
  const result: FanOutResult = { created: 0, linkedExisting: 0, jobIds: [] };
  if (input.discovered.length === 0) return result;

  // Skip anything this connection already holds. Content-hash dedup would
  // catch a re-import anyway, but only AFTER downloading the bytes — and the
  // whole point of a folder walk is that it may re-run over 5000 files.
  const { rows: known } = await pool.query<{ source_file_id: string }>(
    `select source_file_id from files
      where workspace_id = $1 and source_connection_id = $2
        and source_file_id = any($3::text[])`,
    [workspaceId, connectionId, input.discovered.map((d) => d.itemId)],
  );
  const knownIds = new Set(known.map((k) => k.source_file_id));
  const fresh = input.discovered.filter((d) => !knownIds.has(d.itemId));
  result.linkedExisting = input.discovered.length - fresh.length;

  for (const batch of chunk(fresh)) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const assetIds: string[] = [];
      for (const d of batch) {
        const { rows } = await client.query<{ id: string }>(
          `insert into assets (workspace_id, added_by, kind, title)
           values ($1, $2, $3, $4) returning id`,
          [workspaceId, userId, assetKindFromMime(d.mimeType), d.name],
        );
        const assetId = rows[0].id;
        assetIds.push(assetId);
        await client.query(
          `insert into files (asset_id, workspace_id, origin, source_connection_id,
                              source_drive_id, source_file_id, source_path, r2_key,
                              mime_type, byte_size)
           values ($1,$2,'onedrive',$3,$4,$5,$6,null,$7,$8)`,
          [assetId, workspaceId, connectionId, d.driveId, d.itemId, d.path, d.mimeType, d.sizeBytes],
        );
        // The photo facet is NOT written here. Local extraction runs on the
        // real bytes during ingest and is authoritative (ADR 0047 §8.4); the
        // facets ride into that same upsert as fallbacks, so pre-writing them
        // would only add a row that the ingest immediately rewrites.
      }
      if (projectId) {
        await client.query(
          `insert into project_assets (project_id, asset_id, added_by)
           select $1, unnest($2::uuid[]), $3
           on conflict do nothing`,
          [projectId, assetIds, userId],
        );
      }
      // One job per batch, INSIDE the same transaction as its rows: a crash
      // between the two would otherwise leave assets nothing will ever ingest.
      const { rows: jobRows } = await client.query<{ id: string }>(
        `insert into ai_jobs (workspace_id, user_id, type, payload, total_items, done_items)
         values ($1, $2, 'ingest', $3, $4, 0) returning id`,
        [workspaceId, userId, JSON.stringify({ asset_ids: assetIds }), assetIds.length],
      );
      await client.query("commit");
      result.created += assetIds.length;
      result.jobIds.push(jobRows[0].id);
    } catch (err) {
      await client.query("rollback").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  return result;
}

/** The parent job's summary line. */
export function expandProgressLabel(outcome: ExpandOutcome, fan: FanOutResult): string {
  const parts = [
    `Found ${outcome.discovered.length} file(s) in ${outcome.foldersScanned} folder(s)`,
    fan.linkedExisting > 0 ? `${fan.linkedExisting} already imported` : null,
    outcome.skipped > 0 ? `${outcome.skipped} unsupported skipped` : null,
  ].filter(Boolean);
  return parts.join(" — ");
}
