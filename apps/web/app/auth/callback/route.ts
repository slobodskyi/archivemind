import { NextResponse, type NextRequest } from "next/server";
import { safeNextUrl } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/** PKCE code exchange — target of email-confirmation links and of the Google
 *  OAuth redirect (#89). Nothing we send sets `next`, so any value is
 *  caller-supplied by definition; it goes through
 *  safeNextUrl(); `nextUrl` (not `new URL(request.url)`) is the base, because
 *  behind Vercel's proxy only the former carries the public host. */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(safeNextUrl(url.searchParams.get("next"), url.toString()));
    }
  }

  const failure = url.clone();
  failure.pathname = "/login";
  failure.search = "?error=confirm";
  failure.hash = "";
  return NextResponse.redirect(failure);
}
