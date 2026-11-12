/** Originals in the fullscreen viewer (ADR 0054) — the pure rules both sides
 *  of `GET /api/assets/[id]/original` share: which stored files a browser can
 *  draw at all, and when the viewer fetches one.
 *
 *  `files.mime_type` is what the uploading client declared, never sniffed
 *  (ingest says so), and some clients declare nothing or a generic
 *  octet-stream. The key carries the original filename
 *  (`{ws}/originals/{uuid}/{name}`), so its extension is the fallback. */

/** Formats an <img> can decode in some browser. HEIC/HEIF only in WebKit
 *  (`browserDecodes`); RAW, TIFF, PDF and the rest stay at the preview. */
const DISPLAYABLE: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
]);

const BY_EXTENSION: Readonly<Record<string, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
};

const GENERIC = new Set(["", "application/octet-stream", "binary/octet-stream"]);

/** The displayable mime of a stored original, or null when it is a format no
 *  browser draws. A declared specific type wins over the extension: a file
 *  declared `image/tiff` is TIFF whatever it is called. */
export function originalMime(declared: string | null | undefined, key: string): string | null {
  const raw = (declared ?? "").split(";")[0].trim().toLowerCase();
  const mime = raw === "image/jpg" || raw === "image/pjpeg" ? "image/jpeg" : raw;
  if (DISPLAYABLE.has(mime)) return mime;
  if (!GENERIC.has(mime)) return null;
  const name = key.slice(key.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

/** HEIC/HEIF draw in an <img> only in WebKit: Safari on the Mac, and every
 *  browser on iPhone and iPad (they are all WebKit there). Chrome, Firefox and
 *  Edge on the desktop do not — fetching a 4 MB HEIC there only to fail would
 *  cost the bytes and show nothing. An older Safari that cannot either fails
 *  on load, and the viewer falls back to the preview. */
export function browserDecodes(mime: string, userAgent: string): boolean {
  if (mime !== "image/heic" && mime !== "image/heif") return DISPLAYABLE.has(mime);
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  return /\bSafari\//.test(userAgent) && !/\b(Chrome|Chromium|CriOS|Edg|OPR|FxiOS|Firefox|Android)\b/.test(userAgent);
}

/** What the route answers. `not_stored`: the original is not in R2 (Google
 *  Drive and OneDrive files stay in their cloud). `format`: it is, but no
 *  browser can draw it. */
export type OriginalUnavailable = "not_stored" | "format";
export type OriginalAnswer =
  | { url: string; mime: string; bytes: number | null }
  | { url: null; reason: OriginalUnavailable };

/** Above this an original waits for a click: a 62 MB file is a lot to pull on
 *  a phone connection, and a large decode is what kills an iPad Safari tab. */
export const ORIGINAL_AUTO_MAX_BYTES = 40 * 1024 * 1024;

export type OriginalPlan =
  | { kind: "load"; url: string }
  | { kind: "ask"; url: string; bytes: number | null }
  | { kind: "none"; why: OriginalUnavailable | "browser" };

/** Load it, offer it behind a button, or say why there is none. An explicit
 *  click loads whatever size it is; only the automatic fetch is capped. A size
 *  nobody recorded counts as too big to fetch unasked. */
export function planOriginal(
  answer: OriginalAnswer,
  opts: { canDecode: (mime: string) => boolean; explicit: boolean; maxAutoBytes?: number },
): OriginalPlan {
  if (answer.url === null) return { kind: "none", why: answer.reason };
  if (!opts.canDecode(answer.mime)) return { kind: "none", why: "browser" };
  const max = opts.maxAutoBytes ?? ORIGINAL_AUTO_MAX_BYTES;
  if (!opts.explicit && (answer.bytes == null || answer.bytes > max)) {
    return { kind: "ask", url: answer.url, bytes: answer.bytes };
  }
  return { kind: "load", url: answer.url };
}

/** "62 MB" for the Load-original button. */
export function formatBytes(bytes: number | null): string {
  if (bytes == null || !(bytes >= 0)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
