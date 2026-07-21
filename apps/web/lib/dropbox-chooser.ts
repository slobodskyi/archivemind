import type { DropboxImportItem } from "@archivemind/shared";

/** Dropbox Chooser loader + open (ADR 0008, #24). No OAuth anywhere: the
 *  drop-in runs on the user's own dropbox.com web session, we only receive
 *  the files they explicitly picked — direct links (~4 h) + metadata.
 *
 *  Every rejection is a DropboxUiError carrying a first-party code from
 *  lib/drive-errors.ts. */

const DROPINS_SRC = "https://www.dropbox.com/static/api/2/dropins.js";

/** Chooser filters by extension (it has no MIME concept). RAW included —
 *  the worker's decode routes RAW by filename. */
const IMAGE_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".tif", ".tiff",
  ".heic", ".heif", ".bmp", ".dng", ".nef", ".cr2", ".cr3", ".arw", ".raf", ".orf",
];

export class DropboxUiError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DropboxUiError";
  }
}

let dropinsPromise: Promise<void> | null = null;

function loadDropins(appKey: string): Promise<void> {
  if (window.Dropbox) return Promise.resolve();
  if (!dropinsPromise) {
    dropinsPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = DROPINS_SRC;
      script.id = "dropboxjs"; // dropins.js reads its app key off this exact id
      script.dataset.appKey = appKey;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        dropinsPromise = null; // allow a retry after a transient network failure
        reject(new DropboxUiError("dropbox_chooser_failed"));
      };
      document.head.appendChild(script);
    });
  }
  return dropinsPromise;
}

/** Open the Chooser (multiselect, direct links, images only) and resolve with
 *  the picked files (empty array = user cancelled). */
export async function openDropboxChooser(): Promise<DropboxImportItem[]> {
  const appKey = process.env.NEXT_PUBLIC_DROPBOX_APP_KEY;
  if (!appKey) throw new DropboxUiError("dropbox_unavailable");
  await loadDropins(appKey);
  const dropbox = window.Dropbox;
  if (!dropbox || !dropbox.isBrowserSupported()) throw new DropboxUiError("dropbox_chooser_failed");

  return new Promise<DropboxImportItem[]>((resolve) => {
    dropbox.choose({
      linkType: "direct", // required for server-side fetch; expires after ~4 h
      multiselect: true,
      folderselect: false, // incompatible with direct links anyway
      extensions: IMAGE_EXTENSIONS,
      success: (files) =>
        resolve(
          files
            .filter((f) => !f.isDir && typeof f.link === "string" && f.link.length > 0)
            .map((f) => ({
              sourceId: f.id || f.link, // Chooser id; the link is a last-resort key
              name: f.name || "file",
              link: f.link,
              sizeBytes: typeof f.bytes === "number" ? f.bytes : undefined,
            })),
        ),
      cancel: () => resolve([]),
    });
  });
}
