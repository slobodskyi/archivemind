import {
  importResponseSchema,
  type DropboxImportItem,
  type ImportItem,
  type ImportResponse,
} from "@archivemind/shared";

/** Client side of POST /api/imports (ADR 0025). The Picker can return
 *  thousands of docs; the API caps 500 items/request, so the caller's list is
 *  chunked EXPLICITLY here — nothing is silently dropped (upload-client's
 *  slice(0,500) cap is an upload-path behavior, deliberately not reused). */

export const IMPORT_CHUNK_SIZE = 500;

/** Pure + tested: split into ≤size chunks, preserving order, dropping none. */
export function chunkImportItems<T>(items: T[], size = IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export interface DriveImportResult {
  assetIds: string[];
  jobIds: string[];
  skippedDuplicates: number;
  linkedExisting: number;
  /** first-party codes of failed chunks (each chunk = one POST) */
  failedChunks: string[];
}

export type CloudImportSource =
  | { provider: "gdrive"; connectionId: string; items: ImportItem[] }
  | { provider: "dropbox"; items: DropboxImportItem[] };

export async function runCloudImport(input: CloudImportSource & {
  projectId?: string;
  onProgress?: (submitted: number, total: number) => void;
}): Promise<DriveImportResult> {
  const result: DriveImportResult = {
    assetIds: [],
    jobIds: [],
    skippedDuplicates: 0,
    linkedExisting: 0,
    failedChunks: [],
  };
  const allItems: (ImportItem | DropboxImportItem)[] = input.items;
  const chunks = chunkImportItems(allItems);
  let submitted = 0;
  for (const chunk of chunks) {
    try {
      const res = await fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: input.provider,
          ...(input.provider === "gdrive" ? { connectionId: input.connectionId } : {}),
          projectId: input.projectId,
          items: chunk,
        }),
      });
      const raw: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = raw as { error?: unknown };
        result.failedChunks.push(typeof err.error === "string" ? err.error : "drive_import_failed");
      } else {
        const parsed = importResponseSchema.safeParse(raw);
        if (parsed.success) {
          const body: ImportResponse = parsed.data;
          result.assetIds.push(...body.assetIds);
          if (body.jobId) result.jobIds.push(body.jobId);
          result.skippedDuplicates += body.skippedDuplicates;
          result.linkedExisting += body.linkedExisting;
        } else {
          result.failedChunks.push("drive_import_failed");
        }
      }
    } catch {
      result.failedChunks.push("drive_import_failed");
    }
    submitted += chunk.length;
    input.onProgress?.(submitted, input.items.length);
  }
  return result;
}
