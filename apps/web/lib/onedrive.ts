/** Pure shaping for the OneDrive browser (ADR 0047 D1) — no I/O, no env, so
 *  vitest exercises it directly.
 *
 *  We browse Graph ourselves instead of embedding the v8 file picker. The
 *  picker is not an SDK: it is a hand-rolled postMessage protocol against a
 *  SharePoint-resource token that is NOT the Graph token, on a host that
 *  differs per account type. Since `listChildren` has to exist anyway for the
 *  folder walk, browsing is that same call with a breadcrumb on top. */

/** The fields worth asking Graph for. An explicit $select matters at scale:
 *  the default driveItem payload is large, and a folder walk can touch
 *  thousands of items. `@microsoft.graph.downloadUrl` is deliberately NOT here
 *  — it is short-lived (minutes) and the browser never needs it. */
export const ONEDRIVE_CHILD_SELECT =
  "id,name,size,file,folder,photo,location,fileSystemInfo,parentReference";

export interface GraphDriveItem {
  id?: unknown;
  name?: unknown;
  size?: unknown;
  file?: { mimeType?: unknown } | null;
  folder?: { childCount?: unknown } | null;
  parentReference?: { driveId?: unknown; path?: unknown } | null;
}

export interface BrowseEntry {
  driveId: string;
  itemId: string;
  name: string;
  isFolder: boolean;
  sizeBytes: number | null;
  mimeType: string | null;
  /** Direct children only — Graph gives no recursive count. The UI must label
   *  it as an estimate, because a folder of folders reports a small number. */
  childCount: number | null;
  path: string | null;
}

/** `parentReference.path` arrives as an API path like
 *  `/drive/root:/Photos/2024`. The human half is what follows `root:`. */
export function displayPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const marker = raw.indexOf("root:");
  const tail = marker >= 0 ? raw.slice(marker + "root:".length) : raw;
  const decoded = (() => {
    try {
      return decodeURIComponent(tail);
    } catch {
      return tail;
    }
  })();
  return decoded === "" ? "/" : decoded;
}

/** One Graph child → our shape, or null when the row is unusable (no id, or
 *  no drive scope to address it by — an item id alone is not an identity). */
export function toBrowseEntry(raw: GraphDriveItem, fallbackDriveId: string | null): BrowseEntry | null {
  const itemId = typeof raw.id === "string" ? raw.id : null;
  const driveId =
    typeof raw.parentReference?.driveId === "string" ? raw.parentReference.driveId : fallbackDriveId;
  if (!itemId || !driveId) return null;

  const isFolder = raw.folder != null;
  return {
    driveId,
    itemId,
    name: typeof raw.name === "string" && raw.name ? raw.name : "(untitled)",
    isFolder,
    sizeBytes: typeof raw.size === "number" ? raw.size : null,
    mimeType: typeof raw.file?.mimeType === "string" ? raw.file.mimeType : null,
    childCount:
      isFolder && typeof raw.folder?.childCount === "number" ? raw.folder.childCount : null,
    path: displayPath(raw.parentReference?.path),
  };
}

/** Folders first, then files, each A→Z. Graph cannot $orderby on the folder
 *  facet, so the sort is ours — and a file browser that interleaves the two is
 *  unusable for the "pick a folder" job this exists to do. */
export function sortBrowseEntries(entries: BrowseEntry[]): BrowseEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

/** Graph pages with a full `@odata.nextLink` URL. We hand the browser only the
 *  opaque `$skiptoken` out of it, never the URL: echoing a caller-supplied URL
 *  back into a server-side fetch is an SSRF hole, and the token alone is all
 *  the next page needs. */
export function skipTokenFromNextLink(nextLink: unknown): string | null {
  if (typeof nextLink !== "string") return null;
  try {
    const url = new URL(nextLink);
    return url.searchParams.get("$skiptoken") ?? url.searchParams.get("$skipToken");
  } catch {
    return null;
  }
}

/** A skiptoken is opaque, but it is ours to re-send, so bound it and keep it
 *  free of anything that could restructure a query string. */
export function isSafeSkipToken(token: string): boolean {
  return token.length > 0 && token.length <= 2048 && /^[A-Za-z0-9._~!$'()*+,;:@/=%-]+$/.test(token);
}
