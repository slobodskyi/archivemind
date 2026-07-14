import { NextResponse } from "next/server";
import { createProjectRequestSchema, type CreateProjectResponse } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";
import { getProjectCards, type ProjectScope } from "@/lib/projects";

/** GET /api/projects?scope=active|archived|trash — homepage sidebar's
 *  Archived/Trash lists, fetched on demand (the initial page load only
 *  fetches the active scope). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const scopeParam = new URL(request.url).searchParams.get("scope") ?? "active";
  const scope: ProjectScope = scopeParam === "archived" || scopeParam === "trash" ? scopeParam : "active";

  const projects = await getProjectCards(supabase, scope);
  return NextResponse.json({ projects });
}

/** POST /api/projects (spec §9, issue #17) — create a project in the caller's
 *  workspace. RLS scopes the insert (projects_insert = is_editor). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = createProjectRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const { data: row, error } = await supabase
    .from("projects")
    .insert({ workspace_id: workspaceId, name: parsed.data.name, created_by: user.id })
    .select("id, name")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const body: CreateProjectResponse = { id: row.id as string, name: row.name as string };
  return NextResponse.json(body);
}
