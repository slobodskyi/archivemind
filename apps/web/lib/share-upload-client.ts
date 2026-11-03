import {
  shareUploadCompleteHref,
  shareUploadCompleteResponseSchema,
  shareUploadPresignHref,
  shareUploadPresignResponseSchema,
  type ShareUploadCompleteResponse,
  type ShareUploadPresignResponse,
} from "@/lib/project-share-uploads";
import {
  HttpUploadError,
  postJsonWithRetry,
  runTransfers,
  UPLOAD_COMPLETE_TIMEOUT_MS,
  type UploadProgress,
  type UploadTransport,
} from "@/lib/upload-client";
import type { IndexedUploadFile, SkippedUploadFile } from "@/types";

/** Sending files through a project share link (ADR 0051 §9) — the same
 *  transfer engine as the signed-in upload, pointed at `/s/{token}/uploads/*`.
 *  One presign request reserves a whole chunk of 100, each PUT goes to that
 *  reservation's staging key, and completion answers per reservation. */

const PRESIGN_TIMEOUT_MS = 30_000;
/** Completion copies up to 100 objects of up to 100 MiB server-side. */
const COMPLETE_TIMEOUT_MS = Math.max(UPLOAD_COMPLETE_TIMEOUT_MS, 120_000);

export interface ShareUploadResult {
  /** Files that went to the network (selected, not skipped). */
  attempted: number;
  received: number;
  /** Picker indexes that did not arrive, to offer them again. */
  failedIndexes: number[];
  skippedFiles: SkippedUploadFile[];
  /** The link answered 404: turned off, expired, or never could send. */
  linkGone: boolean;
  /** The link's file or byte allowance is used up. */
  quotaReached: boolean;
}

interface Refusals {
  linkGone: boolean;
  quotaReached: boolean;
}

function noteRefusal(error: unknown, refusals: Refusals): void {
  if (!(error instanceof HttpUploadError)) return;
  if (error.status === 404) refusals.linkGone = true;
  if (error.status === 413) refusals.quotaReached = true;
}

/** The link's two endpoints as an upload transport. Exported for tests. */
export function shareUploadTransport(
  token: string,
  senderName: string | null,
  refusals: Refusals = { linkGone: false, quotaReached: false },
): UploadTransport<ShareUploadCompleteResponse> {
  return {
    presign(chunk) {
      // One reservation request per chunk, shared by its files' thunks and
      // made by whichever worker slot asks first.
      let reservation: Promise<ShareUploadPresignResponse> | null = null;
      const reserve = () =>
        (reservation ??= postJsonWithRetry(
          shareUploadPresignHref(token),
          JSON.stringify({
            senderName,
            files: chunk.map(({ file }) => ({
              filename: file.name,
              mime: file.type || "application/octet-stream",
              size: file.size,
            })),
          }),
          { timeoutMs: PRESIGN_TIMEOUT_MS, label: "reserve" },
        )
          .then((body) => {
            const parsed = shareUploadPresignResponseSchema.parse(body);
            if (parsed.uploads.length !== chunk.length) throw new Error("reserve answered a different number of files");
            return parsed;
          })
          .catch((error: unknown) => {
            noteRefusal(error, refusals);
            throw error;
          }));
      return chunk.map((_, position) => async () => {
        const upload = (await reserve()).uploads[position];
        return { uploadUrl: upload.uploadUrl, key: upload.id, contentType: upload.contentType };
      });
    },
    async complete(transferred) {
      try {
        return shareUploadCompleteResponseSchema.parse(
          await postJsonWithRetry(
            shareUploadCompleteHref(token),
            JSON.stringify({ ids: transferred.map((item) => item.key) }),
            { timeoutMs: COMPLETE_TIMEOUT_MS, label: "complete" },
          ),
        );
      } catch (error) {
        noteRefusal(error, refusals);
        throw error;
      }
    },
  };
}

export async function runShareUpload(
  token: string,
  files: readonly File[] | readonly IndexedUploadFile[],
  opts: { senderName?: string | null; onProgress?: (p: UploadProgress) => void } = {},
): Promise<ShareUploadResult> {
  const refusals: Refusals = { linkGone: false, quotaReached: false };
  const run = await runTransfers(files, shareUploadTransport(token, opts.senderName ?? null, refusals), {
    onProgress: opts.onProgress,
  });

  const failed = new Set(run.failedIndexes);
  let received = 0;
  for (const { transferred, result } of run.chunks) {
    const status = new Map(result.results.map((row) => [row.id, row.status]));
    for (const item of transferred) {
      if (status.get(item.key) === "received") received += 1;
      else failed.add(item.inputIndex);
    }
  }

  return {
    attempted: run.attemptedIndexes.length,
    received,
    failedIndexes: Array.from(failed).sort((a, b) => a - b),
    skippedFiles: run.skippedFiles,
    ...refusals,
  };
}
