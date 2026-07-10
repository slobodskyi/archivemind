import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client (anon key; RLS enforced). Create lazily inside
 *  handlers/effects — never at module or render scope, so prerendering and
 *  env-less CI builds never execute it. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
