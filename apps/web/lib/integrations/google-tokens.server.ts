import { encryptToken, decryptToken, parseTokenKey } from "@archivemind/shared/token-crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailFromIdToken, hasDriveScope, mapTokenExchangeError } from "./google-oauth";

/** The ONE module allowed to touch `source_connections` token columns and the
 *  Google token endpoint (ADR 0025). Both the connect and the disconnect route
 *  call in here; nothing else imports `lib/supabase/admin` (ESLint-enforced).
 *
 *  Error discipline (ADR 0021 extended): every failure leaves this module as a
 *  DriveTokenError carrying a FIRST-PARTY code from lib/drive-errors.ts.
 *  Google's response bodies are never rethrown, returned, or logged verbatim —
 *  the connect route serializes `error.code` and nothing else. */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export class DriveTokenError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: number = 502,
  ) {
    super(code); // message IS the code — safe to serialize anywhere
    this.name = "DriveTokenError";
  }
}

function requiredEnv(name: "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET"): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function googleTokenPost(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body: Record<string, unknown> = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** Exchange the popup's authorization code, encrypt tokens, persist the
 *  connection. Returns the account email (may be null) + the row id the
 *  imports API needs. */
export async function exchangeCodeAndStore(input: {
  code: string;
  workspaceId: string;
  userId: string;
}): Promise<{ email: string | null; connectionId: string }> {
  const key = parseTokenKey(process.env.TOKEN_ENC_KEY);
  const { status, body } = await googleTokenPost(TOKEN_URL, {
    client_id: requiredEnv("GOOGLE_CLIENT_ID"),
    client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
    code: input.code,
    grant_type: "authorization_code",
    // GIS popup mode has no real redirect; 'postmessage' is the documented pair.
    redirect_uri: "postmessage",
  });
  if (status !== 200 || typeof body.access_token !== "string") {
    throw new DriveTokenError(mapTokenExchangeError(status, body), 400);
  }
  if (!hasDriveScope(body.scope)) {
    // Granular consent minted a real (partial) grant — revoke it so the user's
    // Google account doesn't keep listing an ArchiveMind grant we hold no
    // token for, and so the retry shows a full consent screen again.
    await googleTokenPost(REVOKE_URL, { token: body.access_token }).catch(() => undefined);
    throw new DriveTokenError("drive_scope_missing", 400);
  }

  const accessToken = body.access_token;
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : null;
  const email = emailFromIdToken(body.id_token);
  const scopes = typeof body.scope === "string" ? body.scope.split(" ") : [];

  const admin = createAdminClient();
  const { data: rows, error: selErr } = await admin
    .from("source_connections")
    .select("id, status, refresh_token_enc, provider_account_email")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "gdrive")
    .order("created_at", { ascending: true });
  if (selErr) throw new DriveTokenError("drive_connect_failed");
  const existing = rows?.[0] ?? null;

  // Google only issues refresh_token on a consent-screen grant. A re-connect
  // over a still-standing grant returns none — fine when we hold a live one
  // FOR THE SAME ACCOUNT, fatal otherwise. The identity check matters: the
  // popup's account chooser is open, so without it a re-pick of account Y
  // would relabel the row as Y while silently keeping X's refresh token —
  // every later worker read would run as X under a row that claims Y.
  const sameAccount =
    existing?.provider_account_email != null &&
    email != null &&
    existing.provider_account_email === email;
  const usableStoredRefresh =
    existing && existing.status === "active" && existing.refresh_token_enc && sameAccount;
  if (!refreshToken && !usableStoredRefresh) {
    // Self-heal: revoke the standing grant (using the fresh access token) so
    // the NEXT attempt shows the consent screen again and yields a refresh
    // token. Guard: /revoke kills the grant for (client, google-account) —
    // if any OTHER connection is backed by this same Google account (shared
    // org accounts like photos@ngo.org), revoking would sever them all, so we
    // skip it and only report; that user picks another account or disconnects
    // the sibling first.
    const { data: siblings } = await admin
      .from("source_connections")
      .select("id")
      .eq("provider", "gdrive")
      .eq("status", "active")
      .eq("provider_account_email", email ?? "")
      .neq("id", existing?.id ?? "00000000-0000-0000-0000-000000000000")
      .limit(1);
    if (!siblings || siblings.length === 0) {
      await googleTokenPost(REVOKE_URL, { token: accessToken }).catch(() => undefined);
    }
    throw new DriveTokenError("drive_reconsent_required", 409);
  }

  // Switching accounts with a fresh consent: the row is about to be rebound to
  // the new account, so revoke the OLD account's grant first — otherwise it
  // stays standing at Google with no row referencing it, unrevokable from our
  // side forever.
  if (refreshToken && existing?.refresh_token_enc && !sameAccount) {
    try {
      const oldRefresh = decryptToken(existing.refresh_token_enc as string, key);
      await googleTokenPost(REVOKE_URL, { token: oldRefresh });
    } catch {
      // Undecryptable or already dead — nothing more we can do for that grant.
    }
  }

  const record = {
    provider_account_email: email,
    access_token_enc: encryptToken(accessToken, key),
    ...(refreshToken ? { refresh_token_enc: encryptToken(refreshToken, key) } : {}),
    scopes,
    status: "active",
  };
  // No unique index on (workspace_id, user_id, provider) yet (schema: issue),
  // so select-then-write; concurrency here is one human clicking Connect.
  let connectionId: string;
  if (existing) {
    const { error: writeErr } = await admin
      .from("source_connections")
      .update(record)
      .eq("id", existing.id);
    if (writeErr) throw new DriveTokenError("drive_connect_failed");
    connectionId = existing.id as string;
  } else {
    const { data: inserted, error: writeErr } = await admin
      .from("source_connections")
      .insert({
        workspace_id: input.workspaceId,
        user_id: input.userId,
        provider: "gdrive",
        ...record,
      })
      .select("id")
      .single();
    if (writeErr || !inserted) throw new DriveTokenError("drive_connect_failed");
    connectionId = inserted.id as string;
  }

  return { email, connectionId };
}

/** Revoke the Google-side grant, then neuter the stored row. The order and
 *  the status check matter: destroying our ciphertexts while the grant still
 *  stands at Google would tell the user "disconnected" about a security
 *  action that silently did not happen — and destroy the only credential
 *  that could ever retry it. So on a failed revoke we keep the tokens, mark
 *  status='error', and surface a retryable failure instead. */
export async function revokeConnection(input: {
  workspaceId: string;
  userId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: rows, error: selErr } = await admin
    .from("source_connections")
    .select("id, refresh_token_enc")
    .eq("workspace_id", input.workspaceId)
    .eq("user_id", input.userId)
    .eq("provider", "gdrive");
  if (selErr) throw new DriveTokenError("drive_disconnect_failed");
  if (!rows || rows.length === 0) throw new DriveTokenError("drive_not_connected", 404);

  const key = parseTokenKey(process.env.TOKEN_ENC_KEY);
  for (const row of rows) {
    if (row.refresh_token_enc) {
      let refresh: string | null = null;
      try {
        refresh = decryptToken(row.refresh_token_enc as string, key);
      } catch {
        // Undecryptable (key rotation accident) — nothing to revoke with;
        // neutering the row is all we can still do.
      }
      if (refresh) {
        let revoked = false;
        try {
          // Revoking the refresh token invalidates the whole pair at Google.
          // 200 = revoked; 400 = token already dead — equally final.
          const { status } = await googleTokenPost(REVOKE_URL, { token: refresh });
          revoked = status === 200 || status === 400;
        } catch {
          revoked = false; // network failure — Google-side grant may still stand
        }
        if (!revoked) {
          await admin.from("source_connections").update({ status: "error" }).eq("id", row.id);
          throw new DriveTokenError("drive_disconnect_failed");
        }
      }
    }
    const { error: updErr } = await admin
      .from("source_connections")
      .update({ status: "revoked", access_token_enc: null, refresh_token_enc: null })
      .eq("id", row.id);
    if (updErr) throw new DriveTokenError("drive_disconnect_failed");
  }
}
