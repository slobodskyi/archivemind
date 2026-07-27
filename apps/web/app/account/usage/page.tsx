import { redirect } from "next/navigation";
import UsageView from "@/components/account/UsageView";
import { ensureWorkspace } from "@/lib/bootstrap";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceUsage } from "@/lib/usage";

/** Usage & Storage — the account area's first real page (the header and
 *  homepage menus have pointed at a "coming soon" toast since the mockup).
 *
 *  Guarded by proxy.ts like every non-public route, so the only auth work left
 *  here is resolving the caller for `ensureWorkspace` — a first-ever visit that
 *  lands here before the homepage still needs its workspace bootstrapped.
 *
 *  Dynamic by nature: it reads live aggregates, and caching a usage meter is
 *  how a user ends up looking at last week's number. */
export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Signature-valid JWT for a user that no longer exists (deleted account,
  // wiped dev DB) — same escape hatch app/page.tsx uses.
  if (!user) redirect("/auth/reset");

  await ensureWorkspace(supabase, user);
  const usage = await getWorkspaceUsage(supabase);
  // No membership at all: nothing to meter. The homepage bootstraps and
  // explains itself far better than an empty dashboard would.
  if (!usage) redirect("/");

  return <UsageView usage={usage} />;
}
