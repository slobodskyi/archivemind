import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * First-login bootstrap per TECH_SPEC §5: profile → default workspace → owner
 * membership. App code, not a DB trigger (easier to evolve). Runs under the
 * user's own RLS-scoped client — migration 0001's policies allow exactly this
 * path (self profile upsert, own workspace insert, self-owner membership on a
 * workspace you created). Idempotent: safe on every page load and under races.
 */
export async function ensureWorkspace(supabase: SupabaseClient, user: User): Promise<string> {
  const { data: existing, error: memberErr } = await supabase
    .from("memberships")
    .select("workspace_id")
    .limit(1);
  if (memberErr) throw memberErr;
  if (existing && existing.length > 0) return existing[0].workspace_id as string;

  const handle = user.email?.split("@")[0] ?? "my";

  const { error: profileErr } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: handle }, { onConflict: "id" });
  if (profileErr) throw profileErr;

  const { data: workspace, error: workspaceErr } = await supabase
    .from("workspaces")
    .insert({ name: `${handle}'s archive`, created_by: user.id })
    .select("id")
    .single();
  if (workspaceErr) throw workspaceErr;

  const { error: membershipErr } = await supabase
    .from("memberships")
    .insert({ workspace_id: workspace.id, user_id: user.id, role: "owner" });
  // 23505 = unique_violation: a concurrent request won the race — fine.
  if (membershipErr && membershipErr.code !== "23505") throw membershipErr;

  return workspace.id as string;
}
