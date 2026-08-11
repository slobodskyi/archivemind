import type { CanvasPoint } from "./canvas";

export type UploadOrigin = "canvas-drop" | "file-picker" | "import-modal";

export interface IndexedUploadFile {
  inputIndex: number;
  file: File;
}

export type UploadSkipReason = "empty" | "too-large" | "batch-limit";

/** A file rejected before any network request, keyed to the original picker
 * index so the UI can report the exact reason without guessing from counts. */
export interface SkippedUploadFile {
  inputIndex: number;
  reason: UploadSkipReason;
}

export interface UploadBatchStart {
  batchId: string;
  origin: UploadOrigin;
  /** Viewport/client coordinates. null means the visible canvas center. */
  clientPoint: CanvasPoint | null;
  files: IndexedUploadFile[];
}

export interface UploadedFileResult {
  inputIndex: number;
  assetId: string;
  /** Chunking creates one ingest job per completion request. */
  jobId: string;
}

export type ProjectLinkState = "linked" | "not-requested" | "failed";

export interface UploadResult {
  /** Original picker indexes touched by this attempt. Retry attempts are deltas. */
  attemptedIndexes: number[];
  assetIds: string[];
  uploaded: UploadedFileResult[];
  failedIndexes: number[];
  skippedIndexes: number[];
  skippedFiles: SkippedUploadFile[];
  /** All ingest jobs created by successful completion chunks. */
  jobIds: string[];
  projectLink: ProjectLinkState;
  /** Uploaded assets whose idempotent project-link request exhausted retries. */
  projectLinkFailedIndexes: number[];
  errors: string[];
  skipped: number;
}

export interface UploadBatchResult extends UploadResult {
  batchId: string;
}
