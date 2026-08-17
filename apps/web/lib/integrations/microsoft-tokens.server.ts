import { encryptToken, decryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MS_GRAPH,
  MS_SCOPES,
  accountTypeFromDriveType,
  emailFromMe,
  hasFilesReadScope,
  mapTokenExchangeError,
  tokenUrl,
  type OneDriveAccountType,
} from "./microsoft-oauth";

/** The ONE module allowed to touch `source_connections` token columns for the
 *  Microsoft provider and to talk to the Entra token endpoint (ADR 0047,
 *  extending ADR 0025's custody rule). Nothing else imports
 *  `lib/supabase/admin` — ESLint fences it to `lib/integrations/*`.
 *
 *  Error discipline (ADR 0021 extended): every failure leaves here as a
 *  OneDriveTokenError carrying a FIRST-PARTY code. Microsoft's response bodies
 *  are never rethrown, returned, or logged verbatim.
 *
 *  Unlike Google, Microsoft exposes NO programmatic token-revocation endpoint,
 *  so `disconnect` can only destroy our side of the grant — see its comment. */

const EXPIRY_SLACK_MS = 5 * 60 * 1000;

export class OneDriveTokenError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number = 502,
  ) {
    super(code); // message IS the code — safe to serialize anywhere
    this.name = "OneDriveTokenError";
  }
}

type MsEnv = "MS_CLIENT_ID" | "MS_CLIENT_SECRET" | "MS_REDIRECT_URI";

function requiredEnv(name: MsEnv): string {
  const v = process.env[name];
  if (!v) throw new OneDriveTokenError("onedrive_connect_failed");
  return v;
}

/** 'common' accepts both personal Microsoft accounts and work/school ones —
 *  ADR 0047 D4 keeps them on one code path. */
export function msTenant(): string {
  return process.env.MS_TENANT || "common";
}

async function tokenPost(params: Record<string, string>) {
  const res = await fetch(tokenUrl(msTenant()), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  }).catch(() => null);
  if (!res) throw new OneDriveTokenError("onedrive_connect_failed");
  const body: Record<string, unknown> = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function graphGet<T>(path: string, accessToken: string): Promise<T | null> {
  const res = await fetch(`${MS_GRAPH}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export interface OneDriveConnectionMeta {
  driveId: string | null;
  accountType: OneDriveAccountType | null;
  accessTokenExpiresAt: number | null;
}

function readMeta(raw: unknown): OneDriveConnectionMeta {
  const m = (raw ?? {}) as Record<string, unknown>;
  return {
    driveId: typeof m.driveId === "string" ? m.driveId : null,
    accountType:
      m.accountType === "personal" || m.accountType === "business" ? m.accountType : null,
    accessTokenExpiresAt:
      typeof m.accessTokenExpiresAt === "number" ? m.accessTokenExpiresAt : null,
  };
}

/** Exchange the redirect's authorization code, resolve the account and its
 *  drive, encrypt both tokens, persist the connection. */
export async function exchangeCodeAndStore(input: {
  code: string;
  codeVerifier: string;
  workspaceId: string;
  userId: string;
}): Promise<{ email: string | null; connectionId: string; accountType: OneDriveAccountType }> {
  const key = parseTokenKey(process.env.TOKEN_ENC_KEY);
  const { status, body } = await tokenPost({
    client_id: requiredEnv("MS_CLIENT_ID"),
    client_secret: requiredEnv("MS_CLIENT_SECRET"),
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: requiredEnv("MS_REDIRECT_URI"),
    code_verifier: input.codeVerifier,
    scope: MS_SCOPES.join(" "),
  });
  if (status !== 200 || typeof body.access_token !== "string") {
    throw new OneDriveTokenError(mapTokenExchangeError(status, body), 400);
  }
  if (!hasFilesReadScope(body.scope)) {
    // A grant without Files.Read cannot list or download anything, so storing
    // it would produce a connection that looks healthy and fails on first use.
    throw new OneDriveTokenError("onedrive_scope_missing", 400);
  }
  // offline_access was requested, so its absence is not a "maybe" like
  // Google's consent-screen-only refresh token — it means the grant cannot
  // outlive the hour, and the worker would lose the drive mid-import.
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
  if (!refreshToken) throw new OneDriveTokenError("onedrive_reconsent_required", 409);

  const accessToken = body.access_token;
  const expiresInS = typeof body.expires_in === "number" ? body.expires_in : 3600;

  // Identity + drive in one pass. Both are best-effort: a connection with an
  // unknown email is usable, and the driveId can be re-resolved later.
  const me = await graphGet<{ mail?: unknown; userPrincipalName?: unknown }>(
    "/me?$select=mail,userPrincipalName,displayName",
    accessToken,
  );
  const drive = await graphGet<{ id?: unknown; driveType?: unknown }>(
    "/me/drive?$select=id,driveType",
    accessToken,
  );
  const email = me ? emailFromMe(me) : null;
  const driveId = typeof drive?.id === "string" ? drive.id : null;
  const accountType = accountTypeFromDriveType(drive?.driveType);

  const admin = createAdminClient();
  const { data: rows, error: selErr } = await admin
    .from("source_connections")
    .select("id")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "onedrive")
    .order("created_at", { ascending: true });
  if (selErr) throw new OneDriveTokenError("onedrive_connect_failed");
  const existing = rows?.[0] ?? null;

  const record = {
    provider_account_email: email,
    access_token_enc: encryptToken(accessToken, key),
    refresh_token_enc: encryptToken(refreshToken, key),
    scopes: typeof body.scope === "string" ? body.scope.split(" ") : [...MS_SCOPES],
    status: "active",
    provider_metadata: {
      driveId,
      accountType,
      accessTokenExpiresAt: Date.now() + expiresInS * 1000 - EXPIRY_SLACK_MS,
    },
  };

  // Re-connecting REPLACES the row wholesale rather than merging: a re-auth is
  // how a user switches Microsoft accounts, and a merge would leave the old
  // account's driveId beside the new account's tokens.
  let connectionId: string;
  if (existing) {
    const { error: writeErr } = await admin
      .from("source_connections")
      .update(record)
      .eq("id", existing.id);
    if (writeErr) throw new OneDriveTokenError("onedrive_connect_failed");
    connectionId = existing.id as string;
  } else {
    const { data: inserted, error: writeErr } = await admin
      .from("source_connections")
      .insert({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        provider: "onedrive",
        ...record,
      })
      .select("id")
      .single();
    if (writeErr || !inserted) throw new OneDriveTokenError("onedrive_connect_failed");
    connectionId = inserted.id as string;
  }

  return { email, connectionId, accountType };
}

export interface GraphSession {
  connectionId: string;
  accessToken: string;
  driveId: string | null;
  accountType: OneDriveAccountType | null;
}

/** A usable Graph access token for the caller's OWN connection, refreshing
 *  when the stored one is stale.
 *
 *  The access token is cached in `access_token_enc` with its expiry in
 *  `provider_metadata.accessTokenExpiresAt` because the web app is serverless:
 *  a process-local cache would miss on essentially every browse click, so each
 *  folder the user opened would cost a token round-trip.
 *
 *  Microsoft ROTATES refresh tokens — the refresh response usually carries a
 *  new one, and the old one stops working. Persisting it is not an
 *  optimisation: miss it and the connection dies silently the next time the
 *  cached access token lapses. */
export async function getGraphSession(input: {
  workspaceId: string;
  userId: string;
  connectionId?: string;
}): Promise<GraphSession> {
  const admin = createAdminClient();
  let q = admin
    .from("source_connections")
    .select("id, status, access_token_enc, refresh_token_enc, provider_metadata")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "onedrive");
  if (input.connectionId) q = q.eq("id", input.connectionId);
  const { data: rows, error } = await q.order("created_at", { ascending: true }).limit(1);
  if (error) throw new OneDriveTokenError("onedrive_connect_failed");

  const row = rows?.[0];
  if (!row) throw new OneDriveTokenError("onedrive_not_connected", 404);
  if (row.status !== "active" || !row.refresh_token_enc) {
    throw new OneDriveTokenError("onedrive_connection_revoked", 409);
  }

  const key = parseTokenKey(process.env.TOKEN_ENC_KEY);
  const meta = readMeta(row.provider_metadata);

  if (row.access_token_enc && meta.accessTokenExpiresAt && meta.accessTokenExpiresAt > Date.now()) {
    try {
      return {
        connectionId: row.id as string,
        accessToken: decryptToken(row.access_token_enc as string, key),
        driveId: meta.driveId,
        accountType: meta.accountType,
      };
    } catch {
      // Undecryptable cached access token (key rotation) — fall through and
      // refresh; the refresh token may still decrypt.
    }
  }

  let refreshToken: string;
  try {
    refreshToken = decryptToken(row.refresh_token_enc as string, key);
  } catch {
    throw new OneDriveTokenError("onedrive_connection_revoked", 409);
  }

  const { status, body } = await tokenPost({
    client_id: requiredEnv("MS_CLIENT_ID"),
    client_secret: requiredEnv("MS_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: MS_SCOPES.join(" "),
  });
  if (status !== 200 || typeof body.access_token !== "string") {
    if (body?.error === "invalid_grant") {
      await admin
        .from("source_connections")
        .update({ status: "revoked" })
        .eq("id", row.id)
        .then(undefined, () => undefined);
      throw new OneDriveTokenError("onedrive_connection_revoked", 409);
    }
    throw new OneDriveTokenError("onedrive_token_refresh_failed");
  }

  const accessToken = body.access_token;
  const expiresInS = typeof body.expires_in === "number" ? body.expires_in : 3600;
  const rotated = typeof body.refresh_token === "string" ? body.refresh_token : null;

  await admin
    .from("source_connections")
    .update({
      access_token_enc: encryptToken(accessToken, key),
      ...(rotated ? { refresh_token_enc: encryptToken(rotated, key) } : {}),
      provider_metadata: {
        ...(row.provider_metadata as Record<string, unknown>),
        accessTokenExpiresAt: Date.now() + expiresInS * 1000 - EXPIRY_SLACK_MS,
      },
    })
    .eq("id", row.id)
    .then(undefined, () => undefined); // a failed cache write must not fail the request

  return {
    connectionId: row.id as string,
    accessToken,
    driveId: meta.driveId,
    accountType: meta.accountType,
  };
}

/** Forget the grant on our side.
 *
 *  Microsoft has no equivalent of Google's /revoke: an app's consent is
 *  withdrawn by the USER, at account.live.com (personal) or myapps (work).
 *  So unlike revokeConnection in google-tokens.server.ts, this cannot promise
 *  the grant is gone upstream — it destroys our ciphertexts and marks the row
 *  revoked, and the UI copy has to tell the user where to finish the job.
 *  Saying "disconnected" without that sentence would be a lie about a security
 *  action. */
export async function disconnect(input: {
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("source_connections")
    .update({ status: "revoked", access_token_enc: null, refresh_token_enc: null })
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "onedrive");
  if (error) throw new OneDriveTokenError("onedrive_disconnect_failed");
}
