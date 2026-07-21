import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role Supabase client — BYPASSES RLS. Exists for exactly one reason:
 *  `source_connections` token columns are column-revoked from `authenticated`
 *  (migration 0001), so the OAuth token custodian cannot use the RLS client.
 *
 *  Do not import this anywhere except `lib/integrations/*` — enforced by
 *  `no-restricted-imports` in eslint.config.mjs. Every new consumer is a
 *  security-review event, not a convenience (ADR 0025). */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set");
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
