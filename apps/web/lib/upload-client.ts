import {
  SINGLE_PUT_MAX_BYTES,
  completeUploadResponseSchema,
  presignUploadResponseSchema,
} from "@archivemind/shared";

/** Shared client-side upload (issue #6/#17): presign → direct R2 PUT →
 *  complete → optionally link the new assets into a project. Used by both the
 *  global UploadManager (drag-drop) and the project ImportModal, so both paths
 *  are byte-identical. Per-file byte progress needs XHR (fetch has none). */

const PARALLEL_UPLOADS = 3;

/** Stage weights inside one file's share of the bar: the presign round-trip
 *  and the server's PUT ack are real work the old bytes-only progress hid —
 *  that's why the bar sat at 0% and then teleported to 100%. */
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

export interface UploadResult {
  assetIds: string[];
  errors: string[];
  /** files skipped up-front (oversize/empty) — surfaced to the user. */
  skipped: number;
}

function putWithProgress(url: string, file: File, onSent: (sent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    // Content-Type is part of the presigned signature — must match exactly.
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => onSent(e.loaded);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 PUT failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("R2 PUT network error"));
    xhr.send(file);
  });
}

export async function runUpload(
  files: File[],
  opts: { projectId?: string; onProgress?: (p: UploadProgress) => void } = {},
): Promise<UploadResult> {
  const accepted = files.filter((f) => f.size > 0 && f.size <= SINGLE_PUT_MAX_BYTES);
  const skipped = files.length - accepted.length;
  if (accepted.length === 0) return { assetIds: [], errors: [], skipped };

  const totalBytes = accepted.reduce((s, f) => s + f.size, 0) || 1;
  const sentPerFile = new Array<number>(accepted.length).fill(0);
  const presigned = new Array<boolean>(accepted.length).fill(false);
  const putAcked = new Array<boolean>(accepted.length).fill(false);
  const errors: string[] = [];
  const completed: { r2Key: string; filename: string; mime: string; size: number }[] = [];
  let doneFiles = 0;
  /** 0 while transferring; bumped as complete/link land. */
  let tail = 0;

  const emit = (stage: UploadStage = "uploading") => {
    const transferred = accepted.reduce((sum, file, i) => {
      const frac =
        (presigned[i] ? PRESIGN_FRAC : 0) +
        BYTES_FRAC * Math.min(1, sentPerFile[i] / file.size) +
        (putAcked[i] ? PUT_ACK_FRAC : 0);
      return sum + frac * (file.size / totalBytes);
    }, 0);
    const progress = stage === "done" ? 1 : Math.min(1, transferred * TRANSFER_CEILING + tail);
    opts.onProgress?.({ totalFiles: accepted.length, doneFiles, progress, stage });
  };
  emit();

  const uploadOne = async (file: File, i: number) => {
    const presignResp = await fetch("/api/uploads/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: file.name, mime: file.type || "application/octet-stream", size: file.size }),
    });
    if (!presignResp.ok) throw new Error(`${file.name}: presign failed (${presignResp.status})`);
    const { uploadUrl, r2Key } = presignUploadResponseSchema.parse(await presignResp.json());
    presigned[i] = true;
    emit();
    await putWithProgress(uploadUrl, file, (sent) => {
      sentPerFile[i] = sent;
      emit();
    });
    sentPerFile[i] = file.size;
    putAcked[i] = true;
    completed.push({ r2Key, filename: file.name, mime: file.type || "application/octet-stream", size: file.size });
    doneFiles += 1;
    emit();
  };

  const queue = accepted.map((file, i) => ({ file, i }));
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        try {
          await uploadOne(next.file, next.i);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    }),
  );

  let assetIds: string[] = [];
  if (completed.length > 0) {
    emit("finalizing"); // bytes are up; asset rows + project link still pending
    const completeResp = await fetch("/api/uploads/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploads: completed }),
    });
    if (completeResp.ok) {
      assetIds = completeUploadResponseSchema.parse(await completeResp.json()).assetIds;
      tail = COMPLETE_DONE - TRANSFER_CEILING;
      emit("finalizing");
    } else {
      errors.push(`complete failed (${completeResp.status})`);
    }
  }

  // Link the fresh assets into the project (issue #17). Best-effort — an upload
  // that lands but fails to link still exists in the workspace.
  if (assetIds.length > 0 && opts.projectId && opts.projectId !== "all") {
    try {
      const linkResp = await fetch(`/api/projects/${opts.projectId}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assetIds }),
      });
      if (!linkResp.ok) errors.push(`add to project failed (${linkResp.status})`);
    } catch {
      errors.push("add to project failed");
    }
  }

  emit("done");
  return { assetIds, errors, skipped };
}
