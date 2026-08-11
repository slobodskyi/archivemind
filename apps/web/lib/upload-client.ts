import {
  COMPLETE_UPLOAD_MAX_ITEMS,
  SINGLE_PUT_MAX_BYTES,
  completeUploadResponseSchema,
  presignUploadResponseSchema,
} from "@archivemind/shared";
import type {
  IndexedUploadFile,
  SkippedUploadFile,
  UploadedFileResult,
  UploadResult,
} from "@/types";

/** Shared client-side upload (issue #6/#17): presign → direct R2 PUT →
 * complete → optionally link the new assets into a project. Used by both the
 * global UploadManager (drag-drop) and the project ImportModal. Per-file byte
 * progress needs XHR (fetch has no upload progress). */

const PARALLEL_UPLOADS = 3;
export const UPLOAD_SELECTION_LIMIT = 500;
export const UPLOAD_COMPLETE_CHUNK_SIZE = COMPLETE_UPLOAD_MAX_ITEMS;
export const UPLOAD_PROJECT_LINK_CHUNK_SIZE = 50;
const MAX_ATTEMPTS = 3;
const PRESIGN_TIMEOUT_MS = 15_000;
export const UPLOAD_COMPLETE_TIMEOUT_MS = 60_000;
const PROJECT_LINK_TIMEOUT_MS = 20_000;
const RETRY_DELAYS_MS = [250, 750] as const;

/** Stage weights inside one file's share of the bar: the presign round-trip
 * and the server's PUT ack are real work the old bytes-only progress hid. */
const PRESIGN_FRAC = 0.06;
const BYTES_FRAC = 0.88;
const PUT_ACK_FRAC = 1 - PRESIGN_FRAC - BYTES_FRAC;
/** Transfers own the bar up to here; complete + project-link own the tail. */
const TRANSFER_CEILING = 0.96;
const COMPLETE_DONE = 0.99;

export type UploadStage = "uploading" | "finalizing" | "done";

export interface UploadProgress {
  totalFiles: number;
  doneFiles: number;
  /** 0..1 stage-weighted progress: presign → bytes → PUT ack → complete/link. */
  progress: number;
  stage: UploadStage;
}

export interface UploadSelection {
  candidates: IndexedUploadFile[];
  skippedFiles: SkippedUploadFile[];
}

export interface RunUploadOptions {
  projectId?: string;
  /** Stable across a first attempt and explicit retry; tracing only. */
  batchId?: string;
  onProgress?: (p: UploadProgress) => void;
}

interface CompletedTransfer {
  inputIndex: number;
  upload: { r2Key: string; filename: string; mime: string; size: number };
}

class HttpUploadError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

class UploadTimeoutError extends Error {}

class PutUploadError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

function createRandomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createUploadBatchId(): string {
  return createRandomUuid();
}

/** One idempotency key per exact `/complete` body. Automatic transport
 * retries reuse it; a new runUpload call (the explicit Retry action) does not. */
export function createUploadCompletionId(): string {
  return createRandomUuid();
}

function normalizeUploadFiles(
  files: readonly File[] | readonly IndexedUploadFile[],
): IndexedUploadFile[] {
  return files.map((entry, index) =>
    "file" in entry && "inputIndex" in entry
      ? { file: entry.file, inputIndex: entry.inputIndex }
      : { file: entry, inputIndex: index },
  );
}

/** Classify the selection once, retaining original indexes for optimistic tile
 * reconciliation and giving every rejected file one explicit reason. Invalid
 * files do not consume the 500 valid-file allowance. */
export function selectUploadFiles(
  files: readonly File[] | readonly IndexedUploadFile[],
): UploadSelection {
  const candidates: IndexedUploadFile[] = [];
  const skippedFiles: SkippedUploadFile[] = [];

  for (const item of normalizeUploadFiles(files)) {
    if (item.file.size <= 0) {
      skippedFiles.push({ inputIndex: item.inputIndex, reason: "empty" });
    } else if (item.file.size > SINGLE_PUT_MAX_BYTES) {
      skippedFiles.push({ inputIndex: item.inputIndex, reason: "too-large" });
    } else if (candidates.length >= UPLOAD_SELECTION_LIMIT) {
      skippedFiles.push({ inputIndex: item.inputIndex, reason: "batch-limit" });
    } else {
      candidates.push(item);
    }
  }

  return { candidates, skippedFiles };
}

/** Files that can enter the multipart-free upload path. Kept as the small
 * compatibility helper used by both upload surfaces. */
export function uploadCandidates(
  files: readonly File[] | readonly IndexedUploadFile[],
): IndexedUploadFile[] {
  return selectUploadFiles(files).candidates;
}

/** Pure + order-preserving; exported so the 100-item transport contract can be
 * pinned without issuing hundreds of mocked requests. */
export function chunkUploadItems<T>(
  items: readonly T[],
  size = UPLOAD_COMPLETE_CHUNK_SIZE,
): T[][] {
  if (!Number.isInteger(size) || size <= 0) throw new Error("upload chunk size must be positive");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function batchHeaders(batchId: string, extra: Record<string, string> = {}): Record<string, string> {
  return { "x-archivemind-upload-batch": batchId, ...extra };
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableFetchError(error: unknown): boolean {
  return (
    error instanceof UploadTimeoutError ||
    error instanceof TypeError ||
    (error instanceof HttpUploadError && isTransientStatus(error.status))
  );
}

async function waitBeforeRetry(failedAttempt: number): Promise<void> {
  const delay = RETRY_DELAYS_MS[failedAttempt - 1] ?? RETRY_DELAYS_MS.at(-1) ?? 0;
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  shouldRetry: (error: unknown) => boolean,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS || !shouldRetry(error)) throw error;
      await waitBeforeRetry(attempt);
    }
  }
  throw lastError;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new UploadTimeoutError(`${label} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Give small files two minutes and scale large files down to a deliberately
 * slow 128 KiB/s connection, capped at 15 minutes. This is a total-request
 * bound; each retry gets a fresh XHR with the same idempotent PUT URL/key. */
function putTimeoutMs(size: number): number {
  const scaled = Math.ceil((size / (128 * 1024)) * 1000) + 30_000;
  return Math.min(15 * 60_000, Math.max(2 * 60_000, scaled));
}

function putOnce(url: string, file: File, onSent: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.timeout = putTimeoutMs(file.size);
    // Content-Type is part of the presigned signature — must match exactly.
    // Do not add tracing headers here: they are not part of R2 CORS/signing.
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => onSent(event.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new PutUploadError(`R2 PUT failed (${xhr.status})`, isTransientStatus(xhr.status)));
    };
    xhr.onerror = () => reject(new PutUploadError("R2 PUT network error", true));
    xhr.ontimeout = () => reject(new PutUploadError("R2 PUT timed out", true));
    xhr.onabort = () => reject(new PutUploadError("R2 PUT aborted", false));
    xhr.send(file);
  });
}

async function putWithRetry(
  url: string,
  file: File,
  onSent: (sent: number) => void,
): Promise<void> {
  await withRetry(
    async (attempt) => {
      if (attempt > 1) onSent(0);
      await putOnce(url, file, onSent);
    },
    (error) => error instanceof PutUploadError && error.retryable,
  );
}

async function presignFile(file: File, inputIndex: number, batchId: string) {
  return withRetry(
    async (attempt) => {
      const response = await fetchWithTimeout(
        "/api/uploads/presign",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...batchHeaders(batchId, {
              "x-archivemind-upload-index": String(inputIndex),
              "x-archivemind-upload-attempt": String(attempt),
            }),
          },
          body: JSON.stringify({
            filename: file.name,
            mime: file.type || "application/octet-stream",
            size: file.size,
          }),
        },
        PRESIGN_TIMEOUT_MS,
        `${file.name}: presign`,
      );
      if (!response.ok) {
        throw new HttpUploadError(`${file.name}: presign failed (${response.status})`, response.status);
      }
      return presignUploadResponseSchema.parse(await response.json());
    },
    isRetryableFetchError,
  );
}

async function linkProjectChunk(
  projectId: string,
  chunk: readonly UploadedFileResult[],
  batchId: string,
  chunkIndex: number,
  chunkCount: number,
): Promise<void> {
  await withRetry(
    async (attempt) => {
      const response = await fetchWithTimeout(
        `/api/projects/${projectId}/assets`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...batchHeaders(batchId, {
              "x-archivemind-upload-chunk": `${chunkIndex}/${chunkCount}`,
              "x-archivemind-upload-attempt": String(attempt),
            }),
          },
          body: JSON.stringify({ assetIds: chunk.map((item) => item.assetId) }),
        },
        PROJECT_LINK_TIMEOUT_MS,
        "add to project",
      );
      if (!response.ok) {
        throw new HttpUploadError(`add to project failed (${response.status})`, response.status);
      }
      const body = await response.json().catch(() => null) as { added?: unknown } | null;
      if (body?.added !== chunk.length) {
        const added = typeof body?.added === "number" ? body.added : 0;
        // The route is allowed to filter assets the caller cannot see. Treat a
        // partial 200 as a failed chunk so a legacy link-only retry is never
        // falsely cleared while some requested memberships are still absent.
        throw new HttpUploadError(
          `add to project incomplete (${added}/${chunk.length})`,
          409,
        );
      }
    },
    isRetryableFetchError,
  );
}

/** Retry only project membership for assets that already exist. The route is
 * idempotent (`upsert ... ignoreDuplicates`), so this never repeats a PUT or
 * creates another asset when a link response is lost. */
export async function retryProjectLinks(
  uploaded: readonly UploadedFileResult[],
  opts: { projectId: string; batchId: string },
): Promise<{ failedIndexes: number[]; errors: string[] }> {
  const failedIndexes: number[] = [];
  const errors: string[] = [];
  const chunks = chunkUploadItems(uploaded, UPLOAD_PROJECT_LINK_CHUNK_SIZE);
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex];
    try {
      await linkProjectChunk(opts.projectId, chunk, opts.batchId, chunkIndex + 1, chunks.length);
    } catch (error) {
      failedIndexes.push(...chunk.map((item) => item.inputIndex));
      errors.push(error instanceof Error ? error.message : "add to project failed");
    }
  }
  return {
    failedIndexes: Array.from(new Set(failedIndexes)).sort((a, b) => a - b),
    errors: Array.from(new Set(errors)),
  };
}

export async function runUpload(
  files: readonly File[] | readonly IndexedUploadFile[],
  opts: RunUploadOptions = {},
): Promise<UploadResult> {
  const batchId = opts.batchId ?? createUploadBatchId();
  const scopedProjectId = opts.projectId && opts.projectId !== "all" ? opts.projectId : undefined;
  const { candidates: accepted, skippedFiles } = selectUploadFiles(files);
  const skippedIndexes = skippedFiles.map((item) => item.inputIndex);
  const attemptedIndexes = accepted.map((item) => item.inputIndex);
  const emptyResult = (): UploadResult => ({
    attemptedIndexes,
    assetIds: [],
    uploaded: [],
    failedIndexes: [],
    skippedIndexes,
    skippedFiles,
    jobIds: [],
    projectLink: "not-requested",
    projectLinkFailedIndexes: [],
    errors: [],
    skipped: skippedFiles.length,
  });
  if (accepted.length === 0) return emptyResult();

  const totalBytes = accepted.reduce((sum, item) => sum + item.file.size, 0) || 1;
  const sentPerFile = new Array<number>(accepted.length).fill(0);
  const presigned = new Array<boolean>(accepted.length).fill(false);
  const putAcked = new Array<boolean>(accepted.length).fill(false);
  const errors: string[] = [];
  const failedIndexes: number[] = [];
  let doneFiles = 0;
  /** 0 while transferring; bumped as completion chunks land or fail. */
  let tail = 0;

  const emit = (stage: UploadStage = "uploading") => {
    const transferred = accepted.reduce((sum, item, index) => {
      const frac =
        (presigned[index] ? PRESIGN_FRAC : 0) +
        BYTES_FRAC * Math.min(1, sentPerFile[index] / item.file.size) +
        (putAcked[index] ? PUT_ACK_FRAC : 0);
      return sum + frac * (item.file.size / totalBytes);
    }, 0);
    const progress = stage === "done" ? 1 : Math.min(1, transferred * TRANSFER_CEILING + tail);
    opts.onProgress?.({ totalFiles: accepted.length, doneFiles, progress, stage });
  };
  emit();

  const uploadOne = async (
    item: IndexedUploadFile,
    acceptedIndex: number,
  ): Promise<CompletedTransfer> => {
    const { uploadUrl, r2Key } = await presignFile(item.file, item.inputIndex, batchId);
    presigned[acceptedIndex] = true;
    emit();
    await putWithRetry(uploadUrl, item.file, (sent) => {
      sentPerFile[acceptedIndex] = sent;
      emit();
    });
    sentPerFile[acceptedIndex] = item.file.size;
    putAcked[acceptedIndex] = true;
    const completed = {
      inputIndex: item.inputIndex,
      upload: {
        r2Key,
        filename: item.file.name,
        mime: item.file.type || "application/octet-stream",
        size: item.file.size,
      },
    };
    doneFiles += 1;
    emit();
    return completed;
  };

  const uploaded: UploadResult["uploaded"] = [];
  const jobIds: string[] = [];
  const candidateChunks = chunkUploadItems(
    accepted.map((item, acceptedIndex) => ({ item, acceptedIndex })),
  );
  let finalizedFiles = 0;

  for (let chunkIndex = 0; chunkIndex < candidateChunks.length; chunkIndex += 1) {
    const candidateChunk = candidateChunks[chunkIndex];
    const completed: CompletedTransfer[] = [];
    const queue = [...candidateChunk];
    emit("uploading");
    await Promise.all(
      Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          try {
            completed.push(await uploadOne(next.item, next.acceptedIndex));
          } catch (error) {
            failedIndexes.push(next.item.inputIndex);
            errors.push(error instanceof Error ? error.message : String(error));
          }
        }
      }),
    );

    if (completed.length > 0) {
      emit("finalizing");
      completed.sort((a, b) => a.inputIndex - b.inputIndex);
      const completionId = createUploadCompletionId();
      const completionBody = JSON.stringify({
        completionId,
        uploads: completed.map((item) => item.upload),
        ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
      });
      try {
        const result = await withRetry(
          async (attempt) => {
            const response = await fetchWithTimeout(
              "/api/uploads/complete",
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  ...batchHeaders(batchId, {
                    "x-archivemind-upload-chunk": `${chunkIndex + 1}/${candidateChunks.length}`,
                    "x-archivemind-upload-attempt": String(attempt),
                  }),
                },
                // Keep this byte-for-byte stable across automatic retries: the
                // RPC compares the completion payload behind completionId.
                body: completionBody,
              },
              UPLOAD_COMPLETE_TIMEOUT_MS,
              `complete chunk ${chunkIndex + 1}/${candidateChunks.length}`,
            );
            if (!response.ok) {
              throw new HttpUploadError(`complete failed (${response.status})`, response.status);
            }
            return completeUploadResponseSchema.parse(await response.json());
          },
          isRetryableFetchError,
        );
        if (result.assetIds.length !== completed.length) {
          throw new Error("complete returned an incomplete asset mapping");
        }
        jobIds.push(result.jobId);
        uploaded.push(
          ...completed.map((item, index) => ({
            inputIndex: item.inputIndex,
            assetId: result.assetIds[index],
            jobId: result.jobId,
          })),
        );
      } catch (error) {
        failedIndexes.push(...completed.map((item) => item.inputIndex));
        errors.push(error instanceof Error ? error.message : "complete failed");
      }
    }

    // Advance the global tail for every settled candidate, including transfer
    // failures. The next chunk keeps all byte/progress arrays and counters.
    finalizedFiles += candidateChunk.length;
    tail = (COMPLETE_DONE - TRANSFER_CEILING) * (finalizedFiles / accepted.length);
    emit("finalizing");
  }

  // A successful completion response now guarantees that project membership
  // was inserted before its ingest job. The standalone helper remains only for
  // retrying link-only failures produced by older/in-flight clients.
  const projectLink: UploadResult["projectLink"] =
    scopedProjectId && uploaded.length > 0 ? "linked" : "not-requested";

  emit("done");
  const orderedUploaded = uploaded.sort((a, b) => a.inputIndex - b.inputIndex);
  return {
    attemptedIndexes,
    assetIds: orderedUploaded.map((item) => item.assetId),
    uploaded: orderedUploaded,
    failedIndexes: Array.from(new Set(failedIndexes)).sort((a, b) => a - b),
    skippedIndexes,
    skippedFiles,
    jobIds,
    projectLink,
    projectLinkFailedIndexes: [],
    errors: Array.from(new Set(errors)),
    skipped: skippedFiles.length,
  };
}
