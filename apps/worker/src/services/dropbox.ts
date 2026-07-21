import { isDropboxDirectLink } from "@archivemind/shared";

/** Dropbox Chooser byte source (ADR 0008, #24): direct links live ~4 h and
 *  cannot be re-minted, so each is fetched ONCE and the original lands in R2
 *  like an upload (the deliberate contrast with Drive — ADR 0008).
 *
 *  Error discipline (ADR 0021 extended): everything thrown here carries a
 *  first-party code as its message (ai_jobs.error broadcasts to browsers).
 *  Dropbox responses go to the worker log only, redacted to status codes. */

export class DropboxFileError extends Error {
  constructor(
    public readonly code: string,
    /** whether a retry of the whole job could plausibly succeed */
    public readonly transient: boolean = false,
  ) {
    super(code);
    this.name = "DropboxFileError";
  }
}

/** Pure: HTTP outcome → verdict. 410 = the 4 h window closed (PLAN's
 *  stale-link guard); 404 behaves the same for the user (re-pick brings a
 *  fresh link); 429 respects Retry-After; 5xx/network back off. */
export function classifyDropboxStatus(status: number): "ok" | "retry" | "expired" | "fatal" {
  if (status >= 200 && status < 300) return "ok";
  if (status === 410 || status === 404) return "expired";
  if (status === 429 || status >= 500) return "retry";
  return "fatal";
}

/** Pure: delay before the next attempt. Dropbox sends Retry-After in seconds
 *  on 429 — honor it (capped) and fall back to truncated exponential backoff
 *  with jitter, same family as the Drive/Gemini services. */
export function dropboxRetryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const retryAfterS = retryAfterHeader != null ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterS) && retryAfterS >= 0) {
    return Math.min(retryAfterS * 1000, 64_000);
  }
  return Math.min(1500 * 2 ** attempt + Math.floor(Math.random() * 400), 64_000);
}

const MAX_TRIES = 5;

/** Fetch a Chooser direct link's bytes. Re-validates the host at fetch time
 *  (defense in depth on top of the route's zod gate) and enforces the size
 *  cap from Content-Length before buffering. */
export async function downloadDropboxLink(link: string, maxBytes: number): Promise<Buffer> {
  if (!isDropboxDirectLink(link)) throw new DropboxFileError("dropbox_download_failed");
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(link);
    } catch {
      await new Promise((r) => setTimeout(r, dropboxRetryDelayMs(null, attempt)));
      continue;
    }
    const verdict = classifyDropboxStatus(res.status);
    if (verdict === "ok") {
      const declared = Number(res.headers.get("content-length") ?? NaN);
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new DropboxFileError("dropbox_file_too_large");
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new DropboxFileError("dropbox_file_too_large");
      return buf;
    }
    if (verdict === "expired") throw new DropboxFileError("dropbox_link_expired");
    if (verdict === "fatal") {
      console.log(`[dropbox] download: HTTP ${res.status} (fatal)`);
      throw new DropboxFileError("dropbox_download_failed");
    }
    console.log(`[dropbox] download: HTTP ${res.status} → backoff ${attempt + 1}/${MAX_TRIES}`);
    await new Promise((r) =>
      setTimeout(r, dropboxRetryDelayMs(res.headers.get("retry-after"), attempt)),
    );
  }
  throw new DropboxFileError("dropbox_rate_limited", true);
}
