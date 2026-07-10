import type { SupabaseClient } from "@supabase/supabase-js";

/** The caller's workspace (MVP: exactly one per user via bootstrap; the seam
 *  for future workspace switching lives here, not in every route). Returns
 *  null when the user has no membership yet. */
export async function getCurrentWorkspaceId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("workspace_id")
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return data && data.length > 0 ? (data[0].workspace_id as string) : null;
}
