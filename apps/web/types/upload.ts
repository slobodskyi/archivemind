import type { CanvasPoint } from "./canvas";

export type UploadOrigin = "canvas-drop" | "file-picker" | "import-modal";

export interface IndexedUploadFile {
  inputIndex: number;
  file: File;
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
}

export type ProjectLinkState = "linked" | "not-requested" | "failed";

export interface UploadResult {
  assetIds: string[];
  uploaded: UploadedFileResult[];
  failedIndexes: number[];
  skippedIndexes: number[];
  jobId: string | null;
  projectLink: ProjectLinkState;
  errors: string[];
  skipped: number;
}

export interface UploadBatchResult extends UploadResult {
  batchId: string;
}
