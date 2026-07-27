import { redirect } from "next/navigation";
import HomeClient from "@/components/home/HomeClient";
import { ensureWorkspace } from "@/lib/bootstrap";
import { getProjectCards } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";
import { getWorkspaceUsage } from "@/lib/usage";

/** Usage & Storage as a deep link. It renders the homepage shell with the
 *  Usage view preselected rather than a layout of its own — the account menus
 *  and the sidebar must land in the same place, and a second chrome for the
 *  same signed-in surface is how an app starts feeling like two apps.
 *
 *  Guarded by proxy.ts like every non-public route, so the only auth work left
 *  is resolving the caller for `ensureWorkspace` — a first-ever visit that
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

  // Parallel, like the homepage: the sidebar needs the project list whichever
  // view is showing, and the meters need the snapshot.
  const [projects, usage, { data: profile }] = await Promise.all([
    getProjectCards(supabase),
    getWorkspaceUsage(supabase),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);

  // No membership at all: nothing to meter. The homepage bootstraps and
  // explains itself far better than an empty dashboard would.
  if (!usage) redirect("/");

  const name = profile?.display_name ?? user.email?.split("@")[0] ?? "You";
  const email = user.email ?? "";
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <HomeClient
      account={{ initials, name, email }}
      projects={projects}
      initialView="usage"
      initialUsage={usage}
    />
  );
}
