import { z } from "zod";
import { COMPLETE_UPLOAD_MAX_ITEMS, presignUploadRequestSchema } from "@archivemind/shared";

/** Anonymous uploads through a project share link (ADR 0051 §9) — the pure half
 *  both the `/s/{token}/uploads/*` routes and the send form import: the request
 *  and response contracts, and the name rules every file passes through before
 *  the reserve RPC sees it. No I/O here, so it is tested directly. */

/** One reserve, one claim, one complete: the RPCs' own 100-row bound, which is
 *  also the ordinary upload path's completion chunk. */
export const PROJECT_SHARE_UPLOAD_BATCH = COMPLETE_UPLOAD_MAX_ITEMS;
/** `assets.received_from` / `project_share_uploads.uploader_name`. */
export const PROJECT_SHARE_SENDER_MAX = 80;
const FILENAME_MAX = 200;
const FALLBACK_MIME = "application/octet-stream";

// Control characters and the bidi overrides that make "photo‮gpj.exe" read as
// "photoexe.jpg" in the owner's drawer. ZWJ stays: emoji sequences need it.
const UNSAFE_CHARS = /[\p{Cc}\p{Bidi_Control}]/gu;

function codePoints(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join("") : value;
}

/** The name the owner will see: the browser's own name minus any path, control
 *  or bidi character, capped at 200 code points with its extension kept. It
 *  always satisfies the table's check (1–255 chars, no control, `/` or `\`). */
export function shareUploadFilename(raw: string): string {
  const leaf = raw.split(/[/\\]/).pop() ?? "";
  // Whitespace first, so a tab or newline becomes a space rather than vanishing.
  const clean = leaf.normalize("NFC").replace(/\s+/g, " ").replace(UNSAFE_CHARS, "").replace(/ {2,}/g, " ").trim();
  if (!clean || /^\.+$/.test(clean)) return "file";
  if (Array.from(clean).length <= FILENAME_MAX) return clean;
  const dot = clean.lastIndexOf(".");
  const ext = dot > 0 ? clean.slice(dot) : "";
  return Array.from(ext).length < 16
    ? `${codePoints(clean.slice(0, dot), FILENAME_MAX - Array.from(ext).length)}${ext}`
    : codePoints(clean, FILENAME_MAX);
}

/** The last segment of the final key, `{ws}/originals/{reservation}/{name}`.
 *  lib/r2 originalKey's sanitizer, plus no leading dot or space, so it always
 *  matches the reserve RPC's `^[A-Za-z0-9_.()+ -]{1,200}$` and never reads as a
 *  relative path segment. */
export function shareUploadKeyName(filename: string): string {
  const safe = filename
    .replace(/[^\w.\-()+ ]+/g, "_")
    .replace(/^[. ]+/, "")
    .slice(0, FILENAME_MAX)
    .trimEnd();
  return safe || "file";
}

/** The Content-Type the PUT is signed with and the browser sends: a plain
 *  `type/subtype` token, anything else (or nothing) as octet-stream. */
export function shareUploadMime(type: string): string {
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i.test(type)
    ? type.toLowerCase()
    : FALLBACK_MIME;
}

/** The optional "from" line: one line of text, or null for nothing. */
export function shareSenderName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const line = raw.normalize("NFC").replace(/\s+/g, " ").replace(UNSAFE_CHARS, "").replace(/ {2,}/g, " ").trim();
  const clean = codePoints(line, PROJECT_SHARE_SENDER_MAX).trim();
  return clean || null;
}

export const shareUploadPresignRequestSchema = z.object({
  senderName: z.string().max(400).nullish(),
  files: z.array(presignUploadRequestSchema).min(1).max(PROJECT_SHARE_UPLOAD_BATCH),
});
export type ShareUploadPresignRequest = z.infer<typeof shareUploadPresignRequestSchema>;

export const shareUploadPresignResponseSchema = z.object({
  uploads: z
    .array(
      z.object({
        /** The reservation — the only id the sender ever holds. */
        id: z.string().uuid(),
        uploadUrl: z.string().url(),
        /** Signed into the PUT: the browser must send exactly this. */
        contentType: z.string().min(1).max(255),
      }),
    )
    .min(1)
    .max(PROJECT_SHARE_UPLOAD_BATCH),
});
export type ShareUploadPresignResponse = z.infer<typeof shareUploadPresignResponseSchema>;

export const shareUploadCompleteRequestSchema = z.object({
  ids: z
    .array(z.string().uuid())
    .min(1)
    .max(PROJECT_SHARE_UPLOAD_BATCH)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate id"),
});
export type ShareUploadCompleteRequest = z.infer<typeof shareUploadCompleteRequestSchema>;

/** received = it is in the project now (or was merged into a copy already
 *  there — the sender is never told which); rejected = the bytes that arrived
 *  were not the bytes declared; pending = not finished (or reserved too long
 *  ago and expired) — send it again. */
export const shareUploadOutcomeSchema = z.enum(["received", "rejected", "pending"]);
export type ShareUploadOutcome = z.infer<typeof shareUploadOutcomeSchema>;

export const shareUploadCompleteResponseSchema = z.object({
  received: z.number().int().nonnegative(),
  results: z.array(z.object({ id: z.string().uuid(), status: shareUploadOutcomeSchema })).max(PROJECT_SHARE_UPLOAD_BATCH),
});
export type ShareUploadCompleteResponse = z.infer<typeof shareUploadCompleteResponseSchema>;

/** The reservation ledger's status as the sender may learn it. */
export function shareUploadOutcome(status: string): ShareUploadOutcome {
  if (status === "completed") return "received";
  if (status === "rejected") return "rejected";
  return "pending";
}

export function shareUploadPresignHref(token: string): string {
  return `/s/${encodeURIComponent(token)}/uploads/presign`;
}

export function shareUploadCompleteHref(token: string): string {
  return `/s/${encodeURIComponent(token)}/uploads/complete`;
}
