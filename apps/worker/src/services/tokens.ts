import type pg from "pg";
import { decryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";

/** Worker-side token custodian (ADR 0025): decrypts source_connections
 *  refresh tokens and mints short-lived Google access tokens on demand.
 *  The worker talks straight to Postgres (service credentials), so no RLS is
 *  in play — treat every read here as privileged and keep tokens off logs.
 *
 *  Error discipline (ADR 0021 extended): ai_jobs.error is broadcast to every
 *  workspace member's browser verbatim, so everything thrown from here
 *  carries a FIRST-PARTY code as its message — never Google's own text. */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Re-mint this many ms before the token's actual expiry. */
const EXPIRY_SLACK_MS = 5 * 60 * 1000;

export class DriveTokenError extends Error {
  constructor(public readonly code: string) {
    super(code); // message IS the code — safe in ai_jobs.error
    this.name = "DriveTokenError";
  }
}

/** Pure: token-endpoint refresh response → outcome. Exported for tests. */
export function parseRefreshResponse(
  status: number,
  body: { access_token?: unknown; expires_in?: unknown; error?: unknown },
): { ok: true; accessToken: string; expiresInS: number } | { ok: false; code: string } {
  if (status === 200 && typeof body.access_token === "string") {
    return {
      ok: true,
      accessToken: body.access_token,
      expiresInS: typeof body.expires_in === "number" ? body.expires_in : 3600,
    };
  }
  // invalid_grant = the user revoked the app (or the token was evicted):
  // not retryable, the connection needs a reconnect in the UI.
  if (body?.error === "invalid_grant") return { ok: false, code: "drive_connection_revoked" };
  return { ok: false, code: "drive_token_refresh_failed" };
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/** Per-job token source: one DB read + one refresh per connection, cached for
 *  the token's lifetime. Construct per handler invocation — never module-wide
 *  (a revoked connection must not serve from a stale cache forever). */
export class DriveTokenSource {
  private cache = new Map<string, CachedToken>();

  constructor(private pool: pg.Pool) {}

  /** Drop a cached token (after a 401 mid-batch: re-mint once and retry). */
  invalidate(connectionId: string): void {
    this.cache.delete(connectionId);
  }

  async getAccessToken(connectionId: string): Promise<string> {
    const cached = this.cache.get(connectionId);
    if (cached && cached.expiresAt > Date.now()) return cached.accessToken;

    const { rows } = await this.pool.query<{ refresh_token_enc: string | null; status: string }>(
      `select refresh_token_enc, status from source_connections
       where id = $1 and provider = 'gdrive'`,
      [connectionId],
    );
    const row = rows[0];
    if (!row || row.status !== "active" || !row.refresh_token_enc) {
      throw new DriveTokenError("drive_connection_revoked");
    }

    let refreshToken: string;
    try {
      refreshToken = decryptToken(row.refresh_token_enc, parseTokenKey(process.env.TOKEN_ENC_KEY));
    } catch {
      // Wrong/rotated TOKEN_ENC_KEY — an ops problem, not a user problem, but
      // the user-visible remedy is the same: reconnect.
      throw new DriveTokenError("drive_connection_revoked");
    }

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: requiredEnv("GOOGLE_CLIENT_ID"),
        client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    }).catch(() => null);
    if (!res) throw new DriveTokenError("drive_token_refresh_failed");
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseRefreshResponse(res.status, body);
    if (!parsed.ok) {
      if (parsed.code === "drive_connection_revoked") {
        await this.pool
          .query(`update source_connections set status = 'revoked' where id = $1`, [connectionId])
          .catch(() => undefined);
      }
      throw new DriveTokenError(parsed.code);
    }

    this.cache.set(connectionId, {
      accessToken: parsed.accessToken,
      expiresAt: Date.now() + parsed.expiresInS * 1000 - EXPIRY_SLACK_MS,
    });
    return parsed.accessToken;
  }
}

function requiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new DriveTokenError("drive_token_refresh_failed");
  return v;
}
