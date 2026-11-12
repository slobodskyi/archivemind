export interface CanvasPoint {
  x: number;
  y: number;
}

export type CanvasUploadStage = "uploading" | "processing" | "ready" | "error";

/** Client-only preview kept separate from server-authoritative Photo records. */
export interface CanvasUploadPreview {
  clientId: string;
  batchId: string;
  inputIndex: number;
  assetId: string | null;
  jobId: string | null;
  filename: string;
  mime: string;
  localUrl: string | null;
  center: CanvasPoint;
  /** The canvas scope `center` was chosen in (a `canvasStoreKey`): the project
   *  canvas, or the Workspace that was open at the drop. A centre only means
   *  something against the tiles of the scope it was placed among (ADR 0052). */
  scope: string;
  width: number;
  height: number;
  stage: CanvasUploadStage;
  message: string | null;
}
