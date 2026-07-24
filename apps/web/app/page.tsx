import { redirect } from "next/navigation";
import HomeClient from "@/components/home/HomeClient";
import LandingPage from "@/components/landing/LandingPage";
import { ensureWorkspace } from "@/lib/bootstrap";
import { getProjectCards } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";

/** "/" serves two audiences. Anonymous visitors get the marketing landing
 *  (proxy.ts lets them through); signed-in users get the homepage hub
 *  (issue #17) — project cards + account. The canvas lives at /projects/[id]. */
export default async function Home() {
  const supabase = await createClient();

  // Cheap local JWT check first: no claims means no session cookie at all —
  // a genuine visitor, so render the landing without a round-trip to Supabase.
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return <LandingPage />;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The JWT was signature-valid, but the user may no longer exist (deleted
  // account, wiped dev DB) — /auth/reset clears the dead cookies.
  if (!user) redirect("/auth/reset");

  // One parallel batch instead of three sequential awaits. ensureWorkspace is
  // idempotent bootstrap; on the very first login the sibling selects may see
  // an empty workspace mid-creation, which renders the same (correct) empty
  // state a brand-new account has anyway.
  const [, projects, { data: profile }] = await Promise.all([
    ensureWorkspace(supabase, user),
    getProjectCards(supabase),
    supabase.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
  ]);

  const name = profile?.display_name ?? user.email?.split("@")[0] ?? "You";
  const email = user.email ?? "";
  const initials = name.slice(0, 2).toUpperCase();

  return <HomeClient account={{ initials, name, email }} projects={projects} />;
}
