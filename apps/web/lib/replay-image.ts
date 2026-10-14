import { createHmac, timingSafeEqual } from "node:crypto";

/** Photos in session replays (ADR 0050 amendment, server half).
 *
 *  A replay is watched in PostHog's player, days later, from PostHog's origin.
 *  The page's own photo URLs are presigned R2 links that die 30–60 min after
 *  the page loaded, and the player sends no ArchiveMind cookies (cross-site),
 *  so neither the original URL nor a session-guarded route can show the photo.
 *
 *  Instead the recorder rewrites each presigned URL to
 *  `/api/replay-image?p=<R2 path>&t=<token>`, and that route answers with a
 *  302 to a fresh presigned URL. The token is an HMAC over ONE workspace id
 *  and an expiry, minted server-side (the secret never reaches the browser),
 *  and it only opens preview-sized derivatives of that workspace: never an
 *  original, never an export. Rotating `REPLAY_IMAGE_SECRET` revokes them all.
 *
 *  Internal testing only. With no secret configured nothing is minted, and the
 *  recorder falls back to blanking the URL, exactly as before. */

/** As long as PostHog keeps a recording, so a replay never outlives its photos. */
export const REPLAY_IMAGE_TOKEN_TTL_S = 30 * 24 * 60 * 60;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// The two preview layouts the worker writes (services/previews.ts and
// services/edit-render.ts). Anything else, originals and exports included, is
// refused by shape before the token is even checked.
const PREVIEW_KEY = new RegExp(`^(${UUID})/(?:previews|edits)/${UUID}/[a-z0-9_-]+\\.webp$`);

function sign(secret: string, workspaceId: string, exp: number): string {
  return createHmac("sha256", secret).update(`replay-image:v1:${workspaceId}:${exp}`).digest("base64url");
}

/** `<exp>.<sig>`, or null when the feature is not configured. */
export function mintReplayImageToken(
  workspaceId: string,
  nowS: number = Math.floor(Date.now() / 1000),
  secret: string | undefined = process.env.REPLAY_IMAGE_SECRET,
): string | null {
  if (!secret) return null;
  const exp = nowS + REPLAY_IMAGE_TOKEN_TTL_S;
  return `${exp}.${sign(secret, workspaceId, exp)}`;
}

/** The R2 key a replay may open, or null. `path` is the presigned URL's
 *  pathname: path-style addressing (`/{bucket}/{key}`), see lib/r2.ts. */
export function verifyReplayImageRequest(
  path: string | null,
  token: string | null,
  bucket: string,
  nowS: number = Math.floor(Date.now() / 1000),
  secret: string | undefined = process.env.REPLAY_IMAGE_SECRET,
): string | null {
  if (!secret || !path || !token) return null;

  const prefix = `/${bucket}/`;
  if (!path.startsWith(prefix)) return null;
  const key = path.slice(prefix.length);
  const shape = PREVIEW_KEY.exec(key);
  if (!shape) return null;

  const [expRaw, sig] = token.split(".");
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp <= nowS || !sig) return null;

  const expected = Buffer.from(sign(secret, shape[1], exp));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return key;
}
