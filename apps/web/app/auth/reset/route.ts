import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Dead-session escape hatch. proxy.ts validates the JWT *signature* (fast),
 *  so a cookie for a since-deleted user still counts as "authed" there — but
 *  page-level getUser() returns null. Redirecting straight to /login would
 *  bounce forever (proxy sends authed users back to /). This route clears the
 *  cookies (allowed in a Route Handler, unlike a Server Component) and breaks
 *  the loop. */
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 302 });
}
