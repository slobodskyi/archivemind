import type pg from "pg";
import { decryptToken, encryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";
import {
  formatAperture,
  formatFocalLength,
  formatShutter,
  type ParsedExif,
} from "./exif";

/** Microsoft Graph byte + metadata source for ingest (ADR 0047).
 *
 *  OneDrive originals are never copied into R2 — like Drive (TECH_SPEC §6,
 *  ADR 0025) and unlike Dropbox, the connection is durable, so the bytes are
 *  re-read at processing time and `files.r2_key` stays null.
 *
 *  Error discipline (ADR 0021 extended): everything thrown here carries a
 *  first-party code as its message, because ai_jobs.error is broadcast to
 *  browsers. Microsoft's bodies go to the worker log, redacted to a status. */

const GRAPH = "https://graph.microsoft.com/v1.0";

/** Everything the ingest path needs from a driveItem, in one round trip.
 *  An explicit $select is not cosmetic at this scale: a folder walk can touch
 *  thousands of items, and the default driveItem payload is large. */
export const ONEDRIVE_ITEM_SELECT =
  "id,name,size,file,folder,photo,location,fileSystemInfo,parentReference,@microsoft.graph.downloadUrl";

export class OneDriveFileError extends Error {
  constructor(
    public readonly code: string,
    /** whether a retry of the whole job could plausibly succeed */
    public readonly transient: boolean = false,
  ) {
    super(code);
    this.name = "OneDriveFileError";
  }
}

export class OneDriveTokenError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "OneDriveTokenError";
  }
}

// ── pure: status → verdict, and how long to wait ────────────────────────────

export type GraphVerdict = "ok" | "retry" | "not_found" | "unauthorized" | "fatal";

/** Graph signals throttling with 429 AND 503 — treating only 429 as throttling
 *  is the classic way to keep hammering a service that just asked you to stop. */
export function classifyGraphStatus(status: number): GraphVerdict {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404) return "not_found";
  if (status === 401) return "unauthorized";
  if (status === 429 || status === 503) return "retry";
  if (status >= 500) return "retry";
  return "fatal";
}

/** `Retry-After` is authoritative and must not be undercut: the docs are
 *  explicit that apps calling back early "will be blocked due to abusive
 *  calling patterns". Only when the header is absent do we back off ourselves,
 *  with jitter. Seconds in, milliseconds out. */
export function retryDelayMs(retryAfterHeader: string | null, attempt: number): number {
  const seconds = Number(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 120_000);
  return Math.min(1500 * 2 ** attempt + Math.floor(Math.random() * 400), 64_000);
}

/** The circuit breaker the Graph docs actually ask for: "when waiting for 429
 *  or 503 recovery you should ensure that you PAUSE ALL FURTHER REQUESTS you
 *  are making to the service. This is especially important in multi-threaded
 *  scenarios."
 *
 *  Per-request backoff alone does not do that — the other in-flight requests
 *  keep arriving and extend the throttling. One gate per connection: a 429 on
 *  any request holds every later one until the window passes. */
export class ThrottleGate {
  private pausedUntil = 0;

  pauseFor(ms: number): void {
    const until = Date.now() + ms;
    if (until > this.pausedUntil) this.pausedUntil = until;
  }

  /** ms still to wait, 0 when clear — exported shape for tests. */
  remainingMs(now = Date.now()): number {
    return Math.max(0, this.pausedUntil - now);
  }

  async wait(): Promise<void> {
    const ms = this.remainingMs();
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }
}

// ── pure: the photo/location facets → our EXIF shape ────────────────────────

export interface GraphPhotoFacet {
  takenDateTime?: unknown;
  cameraMake?: unknown;
  cameraModel?: unknown;
  fNumber?: unknown;
  focalLength?: unknown;
  iso?: unknown;
  exposureNumerator?: unknown;
  exposureDenominator?: unknown;
}

export interface GraphLocationFacet {
  latitude?: unknown;
  longitude?: unknown;
}

export interface OneDriveItem {
  id: string;
  name: string;
  size: number | null;
  mimeType: string | null;
  isFolder: boolean;
  childCount: number | null;
  downloadUrl: string | null;
  path: string | null;
  photo: GraphPhotoFacet | null;
  location: GraphLocationFacet | null;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Graph's facets → the subset of ParsedExif they can fill.
 *
 *  These are a PRE-FILL, never the source of truth (ADR 0047 §8.4). Two
 *  reasons, and the first is documented rather than suspected: OneDrive for
 *  Business and SharePoint return ONLY `takenDateTime` from the photo facet,
 *  so a facets-first path would hand business users a near-empty archive.
 *  The second is that facet coverage on RAW and HEIC is unverified. Local
 *  extraction runs on every file regardless; this only fills its gaps. */
export function exifFromFacets(item: OneDriveItem): Partial<ParsedExif> | null {
  const p = item.photo;
  const l = item.location;
  if (!p && !l) return null;

  const takenRaw = str(p?.takenDateTime);
  const taken = takenRaw ? new Date(takenRaw) : null;
  const numerator = num(p?.exposureNumerator);
  const denominator = num(p?.exposureDenominator);
  const exposureSeconds =
    numerator != null && denominator != null && denominator !== 0 ? numerator / denominator : undefined;

  const out: Partial<ParsedExif> = {
    taken_at: taken && !Number.isNaN(taken.getTime()) ? taken : null,
    camera_make: str(p?.cameraMake),
    camera_model: str(p?.cameraModel),
    gps_lat: num(l?.latitude) ?? null,
    gps_lon: num(l?.longitude) ?? null,
    iso: num(p?.iso) ?? null,
    aperture: formatAperture(num(p?.fNumber)),
    shutter: formatShutter(exposureSeconds),
    focal_length: formatFocalLength(num(p?.focalLength)),
  };
  return out;
}

/** Local EXIF wins wherever it has an answer; facets fill only the nulls.
 *
 *  Both halves of ADR 0047 §8.4 fall out of this one function: "prefer local
 *  EXIF when they disagree" is the `local[k] != null` test, and "fill gaps
 *  where local extraction returns nothing" is the fallback. When local
 *  extraction produced nothing at all, the facets alone become the row —
 *  better a date from Graph than a photo with no date. */
export function mergeExifFallback(
  local: ParsedExif | null,
  facet: Partial<ParsedExif> | null,
): ParsedExif | null {
  if (!facet) return local;
  const base: ParsedExif = local ?? {
    taken_at: null,
    camera_make: null,
    camera_model: null,
    lens: null,
    gps_lat: null,
    gps_lon: null,
    iso: null,
    aperture: null,
    shutter: null,
    focal_length: null,
    raw: {},
  };
  return {
    ...base,
    taken_at: base.taken_at ?? facet.taken_at ?? null,
    camera_make: base.camera_make ?? facet.camera_make ?? null,
    camera_model: base.camera_model ?? facet.camera_model ?? null,
    // GPS is a PAIR: taking a latitude from one source and a longitude from
    // the other would invent a location neither reported.
    ...(base.gps_lat == null && base.gps_lon == null
      ? { gps_lat: facet.gps_lat ?? null, gps_lon: facet.gps_lon ?? null }
      : {}),
    iso: base.iso ?? facet.iso ?? null,
    aperture: base.aperture ?? facet.aperture ?? null,
    shutter: base.shutter ?? facet.shutter ?? null,
    focal_length: base.focal_length ?? facet.focal_length ?? null,
  };
}

/** Raw Graph JSON → our item shape. Tolerant by design: a row missing `name`
 *  or `size` is still importable, a row missing `id` is not. */
export function toOneDriveItem(raw: Record<string, unknown>): OneDriveItem | null {
  const id = str(raw.id);
  if (!id) return null;
  const folder = raw.folder as { childCount?: unknown } | null | undefined;
  const file = raw.file as { mimeType?: unknown } | null | undefined;
  const parent = raw.parentReference as { path?: unknown } | null | undefined;
  return {
    id,
    name: str(raw.name) ?? id,
    size: num(raw.size) ?? null,
    mimeType: str(file?.mimeType),
    isFolder: folder != null,
    childCount: num(folder?.childCount) ?? null,
    downloadUrl: str(raw["@microsoft.graph.downloadUrl"]),
    path: str(parent?.path),
    photo: (raw.photo as GraphPhotoFacet | undefined) ?? null,
    location: (raw.location as GraphLocationFacet | undefined) ?? null,
  };
}

// ── token custody ───────────────────────────────────────────────────────────

const EXPIRY_SLACK_MS = 5 * 60 * 1000;
const TOKEN_URL_BASE = "https://login.microsoftonline.com";

function msTenant(): string {
  return process.env.MS_TENANT || "common";
}

function requiredEnv(name: "MS_CLIENT_ID" | "MS_CLIENT_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new OneDriveTokenError("onedrive_token_refresh_failed");
  return v;
}

/** Pure: refresh response → outcome. Exported for tests. */
export function parseRefreshResponse(
  status: number,
  body: { access_token?: unknown; expires_in?: unknown; refresh_token?: unknown; error?: unknown },
):
  | { ok: true; accessToken: string; expiresInS: number; rotatedRefresh: string | null }
  | { ok: false; code: string } {
  if (status === 200 && typeof body.access_token === "string") {
    return {
      ok: true,
      accessToken: body.access_token,
      expiresInS: typeof body.expires_in === "number" ? body.expires_in : 3600,
      // Microsoft ROTATES refresh tokens. Losing the new one kills the
      // connection the moment the access token lapses, with no error at the
      // time it happens — so it is surfaced here rather than ignored.
      rotatedRefresh: typeof body.refresh_token === "string" ? body.refresh_token : null,
    };
  }
  if (body?.error === "invalid_grant") return { ok: false, code: "onedrive_connection_revoked" };
  return { ok: false, code: "onedrive_token_refresh_failed" };
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/** Per-job token source. Construct per handler invocation, never module-wide —
 *  a revoked connection must not serve from a stale cache forever. */
export class OneDriveTokenSource {
  private cache = new Map<string, CachedToken>();

  constructor(private pool: pg.Pool) {}

  invalidate(connectionId: string): void {
    this.cache.delete(connectionId);
  }

  async getAccessToken(connectionId: string): Promise<string> {
    const cached = this.cache.get(connectionId);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

    const { rows } = await this.pool.query<{ refresh_token_enc: string | null; status: string }>(
      `select refresh_token_enc, status from source_connections
       where id = $1 and provider = 'onedrive'`,
      [connectionId],
    );
    const row = rows[0];
    if (!row || row.status !== "active" || !row.refresh_token_enc) {
      throw new OneDriveTokenError("onedrive_connection_revoked");
    }

    const key = parseTokenKey(process.env.TOKEN_ENC_KEY);
    let refreshToken: string;
    try {
      refreshToken = decryptToken(row.refresh_token_enc, key);
    } catch {
      // Wrong/rotated TOKEN_ENC_KEY — an ops problem, but the user-visible
      // remedy is the same: reconnect.
      throw new OneDriveTokenError("onedrive_connection_revoked");
    }

    const res = await fetch(`${TOKEN_URL_BASE}/${encodeURIComponent(msTenant())}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("MS_CLIENT_ID"),
        client_secret: requiredEnv("MS_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "offline_access User.Read Files.Read",
      }),
    }).catch(() => null);
    if (!res) throw new OneDriveTokenError("onedrive_token_refresh_failed");

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseRefreshResponse(res.status, body);
    if (!parsed.ok) {
      if (parsed.code === "onedrive_connection_revoked") {
        await this.pool
          .query(`update source_connections set status = 'revoked' where id = $1`, [connectionId])
          .catch(() => undefined);
      }
      throw new OneDriveTokenError(parsed.code);
    }

    if (parsed.rotatedRefresh) {
      // Persisted immediately, before the token is handed out: if the process
      // dies right after this call, the row must already hold the token that
      // still works.
      await this.pool
        .query(`update source_connections set refresh_token_enc = $2 where id = $1`, [
          connectionId,
          encryptToken(parsed.rotatedRefresh, key),
        ])
        .catch((err) => console.log(`[onedrive] refresh-token rotation not persisted: ${String(err)}`));
    }

    this.cache.set(connectionId, {
      accessToken: parsed.accessToken,
      expiresAt: Date.now() + parsed.expiresInS * 1000 - EXPIRY_SLACK_MS,
    });
    return parsed.accessToken;
  }
}

// ── Graph calls ─────────────────────────────────────────────────────────────

const MAX_TRIES = 5;

async function graphFetch(
  url: string,
  accessToken: string,
  gate: ThrottleGate,
  label: string,
): Promise<Response> {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    await gate.wait(); // honour any pause another request already earned
    let res: Response;
    try {
      res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
    } catch {
      await new Promise((r) => setTimeout(r, retryDelayMs(null, attempt)));
      continue;
    }
    const verdict = classifyGraphStatus(res.status);
    if (verdict === "ok") return res;
    if (verdict === "not_found") throw new OneDriveFileError("onedrive_file_not_found");
    if (verdict === "unauthorized") throw new OneDriveFileError("onedrive_token_expired", true);
    if (verdict === "fatal") {
      console.log(`[onedrive] ${label}: HTTP ${res.status} (fatal)`);
      throw new OneDriveFileError("onedrive_download_failed");
    }
    const delay = retryDelayMs(res.headers.get("retry-after"), attempt);
    // The pause is registered on the GATE, not just slept locally, so every
    // other request on this connection waits it out too.
    gate.pauseFor(delay);
    console.log(`[onedrive] ${label}: HTTP ${res.status} → pausing ${delay}ms (${attempt + 1}/${MAX_TRIES})`);
    await gate.wait();
  }
  console.log(`[onedrive] ${label}: retries exhausted`);
  throw new OneDriveFileError("onedrive_rate_limited", true);
}

function itemUrl(driveId: string | null, itemId: string): string {
  const id = encodeURIComponent(itemId);
  return driveId ? `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${id}` : `${GRAPH}/me/drive/items/${id}`;
}

/** One driveItem, including the short-lived download URL. */
export async function getOneDriveItem(
  driveId: string | null,
  itemId: string,
  accessToken: string,
  gate: ThrottleGate,
): Promise<OneDriveItem> {
  const res = await graphFetch(
    `${itemUrl(driveId, itemId)}?$select=${encodeURIComponent(ONEDRIVE_ITEM_SELECT)}`,
    accessToken,
    gate,
    `meta ${itemId.slice(0, 12)}`,
  );
  const raw = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const item = raw ? toOneDriveItem(raw) : null;
  if (!item) throw new OneDriveFileError("onedrive_download_failed");
  return item;
}

/** A folder's children, page by page. Graph's default page is 200 items and
 *  `@odata.nextLink` carries the cursor, so paging is the caller's only job. */
export async function* listOneDriveChildren(
  driveId: string | null,
  itemId: string,
  accessToken: string,
  gate: ThrottleGate,
): AsyncGenerator<OneDriveItem> {
  let url: string | null =
    `${itemUrl(driveId, itemId)}/children?$select=${encodeURIComponent(ONEDRIVE_ITEM_SELECT)}&$top=200`;
  let page = 0;
  while (url) {
    const res: Response = await graphFetch(url, accessToken, gate, `children p${page}`);
    const body = (await res.json().catch(() => null)) as {
      value?: Record<string, unknown>[];
      "@odata.nextLink"?: unknown;
    } | null;
    if (!body) throw new OneDriveFileError("onedrive_folder_scan_failed", true);
    for (const raw of body.value ?? []) {
      const item = toOneDriveItem(raw);
      if (item) yield item;
    }
    url = typeof body["@odata.nextLink"] === "string" ? body["@odata.nextLink"] : null;
    page += 1;
  }
}

/** Original bytes, via the pre-authenticated download URL.
 *
 *  Two rules the docs are explicit about, both easy to get wrong:
 *   - NO Authorization header. The URL carries its own credential, and adding
 *     ours is at best redundant.
 *   - Use it immediately. It "might expire within minutes", which is why the
 *     URL is resolved per file right before the fetch and never parked in a
 *     job payload the way Dropbox's ~4 h links are (ADR 0008).
 *
 *  Bounded buffering rather than streaming, per ADR 0047 D3: the whole ingest
 *  pipeline is Buffer-shaped (exiftool reads a path, not a stream), so the
 *  guard that matters is the size cap plus serial downloads — worst case is
 *  ONE maxBytes buffer, exactly as Drive and Dropbox already behave. */
export async function downloadOneDriveFile(downloadUrl: string, maxBytes: number): Promise<Buffer> {
  const res = await fetch(downloadUrl).catch(() => null);
  if (!res) throw new OneDriveFileError("onedrive_download_failed", true);
  if (!res.ok) {
    const verdict = classifyGraphStatus(res.status);
    if (verdict === "not_found") throw new OneDriveFileError("onedrive_file_not_found");
    throw new OneDriveFileError("onedrive_download_failed", verdict === "retry");
  }
  // Refuse on the declared size before reading a byte, when it is declared.
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new OneDriveFileError("onedrive_file_too_large");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  // ...and again on what actually arrived: content-length is a claim.
  if (buf.length > maxBytes) throw new OneDriveFileError("onedrive_file_too_large");
  return buf;
}
