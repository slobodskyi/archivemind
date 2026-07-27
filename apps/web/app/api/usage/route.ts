import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceUsage } from "@/lib/usage";

/** Usage & Storage for the homepage's Usage view. The sidebar switches views
 *  client-side (same as Archived/Trash), and client components never touch the
 *  database — so the snapshot comes over HTTP from here, while
 *  /account/usage's Server Component awaits `getWorkspaceUsage` directly.
 *
 *  Both paths run the same RLS-scoped RPC; this one adds nothing but the
 *  transport. */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const usage = await getWorkspaceUsage(supabase);
  if (!usage) return NextResponse.json({ error: "no_workspace" }, { status: 404 });

  return NextResponse.json({ usage });
}
