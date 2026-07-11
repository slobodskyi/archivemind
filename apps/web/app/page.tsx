import { redirect } from "next/navigation";
import HomeClient from "@/components/home/HomeClient";
import { ensureWorkspace } from "@/lib/bootstrap";
import { getAllAssetsCount, getProjectCards } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";

/** Homepage hub (issue #17) — the landing page after login: project cards +
 *  sources + account. The canvas lives at /projects/[id]. */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy.ts passed a signature-valid JWT, but the user may no longer exist
  // (deleted account, wiped dev DB) — /auth/reset clears the dead cookies.
  if (!user) redirect("/auth/reset");

  // One parallel batch instead of three sequential awaits. ensureWorkspace is
  // idempotent bootstrap; on the very first login the sibling selects may see
  // an empty workspace mid-creation, which renders the same (correct) empty
  // state a brand-new account has anyway.
  const [, projects, allCount, { data: profile }] = await Promise.all([
    ensureWorkspace(supabase, user),
    getProjectCards(supabase),
    getAllAssetsCount(supabase),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);

  const name = profile?.display_name ?? user.email?.split("@")[0] ?? "You";
  const email = user.email ?? "";
  const initials = name.slice(0, 2).toUpperCase();

  return <HomeClient account={{ initials, name, email }} projects={projects} allCount={allCount} />;
}
