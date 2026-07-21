/** Google Drive v3 byte source for ingest (ADR 0025): metadata + alt=media
 *  download with quota-aware retry. Drive originals are never copied to R2
 *  (TECH_SPEC §6) — this module is how their bytes reach the preview/EXIF
 *  pipeline at processing time.
 *
 *  Error discipline (ADR 0021 extended): everything thrown here carries a
 *  first-party code as its message (ai_jobs.error broadcasts to browsers).
 *  Google's response bodies go to the worker log only, redacted to status. */

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export class DriveFileError extends Error {
  constructor(
    public readonly code: string,
    /** whether a retry of the whole job could plausibly succeed */
    public readonly transient: boolean = false,
  ) {
    super(code);
    this.name = "DriveFileError";
  }
}

export interface DriveFileMeta {
  size: number | null;
  mimeType: string | null;
  md5Checksum: string | null;
}

/** Pure: HTTP outcome → retry/verdict. 429 + quota-flavored 403s back off;
 *  404 = grant missing (file deleted, or picked without setAppId);
 *  401 = access token died mid-batch (caller re-mints once). */
export function classifyDriveStatus(
  status: number,
  bodySnippet: string,
): "ok" | "retry" | "not_found" | "unauthorized" | "fatal" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404) return "not_found";
  if (status === 401) return "unauthorized";
  if (status === 429) return "retry";
  if (status === 403 && /userRateLimitExceeded|rateLimitExceeded|quotaExceeded/i.test(bodySnippet))
    return "retry";
  if (status >= 500) return "retry";
  return "fatal";
}

/** Truncated exponential backoff delay, ms (same family as gemini.ts). */
export function backoffMs(attempt: number): number {
  return Math.min(1500 * 2 ** attempt + Math.floor(Math.random() * 400), 64_000);
}

const MAX_TRIES = 5;

async function driveFetch(
  path: string,
  accessToken: string,
  label: string,
): Promise<Response> {
  let last: { status: number; snippet: string } = { status: 0, snippet: "network" };
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${DRIVE_API}/${path}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // network hiccup — same backoff as a 5xx
      last = { status: 0, snippet: "network" };
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      continue;
    }
    if (res.ok) return res;
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    const verdict = classifyDriveStatus(res.status, snippet);
    if (verdict === "not_found") throw new DriveFileError("drive_file_not_found");
    if (verdict === "unauthorized") throw new DriveFileError("drive_token_expired", true);
    if (verdict === "fatal") {
      console.log(`[gdrive] ${label}: HTTP ${res.status} (fatal)`);
      throw new DriveFileError("drive_download_failed");
    }
    last = { status: res.status, snippet };
    console.log(`[gdrive] ${label}: HTTP ${res.status} → backoff ${attempt + 1}/${MAX_TRIES}`);
    await new Promise((r) => setTimeout(r, backoffMs(attempt)));
  }
  console.log(`[gdrive] ${label}: retries exhausted (last HTTP ${last.status})`);
  throw new DriveFileError("drive_rate_limited", true);
}

/** files.get metadata (5 quota units) — size guard + md5 without downloading. */
export async function getDriveFileMeta(
  fileId: string,
  accessToken: string,
): Promise<DriveFileMeta> {
  const id = encodeURIComponent(fileId); // defense in depth on top of the zod regex
  const res = await driveFetch(
    `files/${id}?fields=size,mimeType,md5Checksum&supportsAllDrives=true`,
    accessToken,
    `meta ${fileId.slice(0, 10)}`,
  );
  const body = (await res.json().catch(() => ({}))) as {
    size?: string;
    mimeType?: string;
    md5Checksum?: string;
  };
  return {
    size: body.size != null ? Number(body.size) : null,
    mimeType: body.mimeType ?? null,
    md5Checksum: body.md5Checksum ?? null,
  };
}

/** files.get?alt=media (200 quota units) — original bytes, any binary type. */
export async function downloadDriveFile(fileId: string, accessToken: string): Promise<Buffer> {
  const id = encodeURIComponent(fileId);
  const res = await driveFetch(
    `files/${id}?alt=media&supportsAllDrives=true`,
    accessToken,
    `download ${fileId.slice(0, 10)}`,
  );
  return Buffer.from(await res.arrayBuffer());
}
