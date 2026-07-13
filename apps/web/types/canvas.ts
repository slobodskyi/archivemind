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
  width: number;
  height: number;
  stage: CanvasUploadStage;
  message: string | null;
}
