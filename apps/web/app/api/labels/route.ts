import { NextResponse } from "next/server";
import { renameLabelRequestSchema } from "@archivemind/shared";
import { getLabelNames } from "@/lib/labels";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** GET /api/labels — the workspace's seven colour names (defaults with any
 *  renames applied). The canvas gets these from the Server Component on load;
 *  this exists for the client-side refresh after a rename. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({ names: await getLabelNames(supabase) });
}

/** PATCH /api/labels — rename one colour, workspace-wide.
 *
 *  "Red" means nothing; "Rejected" means everything — a colour label is only
 *  useful once it carries the user's own workflow word, which is why this route
 *  exists at all rather than the seven names being constants. Same shape as the
 *  Topic-cloud rename (ADR 0038): a human-set name is pinned and nothing ever
 *  regenerates over it.
 *
 *  An empty name DELETES the override row rather than storing "" — that is the
 *  reset-to-default path, and a nameless swatch would be unusable. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = renameLabelRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { label, name } = parsed.data;

  const { error } = name
    ? await supabase
        .from("workspace_labels")
        .upsert(
          { workspace_id: workspaceId, label, name, updated_by: user.id, updated_at: new Date().toISOString() },
          { onConflict: "workspace_id,label" },
        )
    : await supabase.from("workspace_labels").delete().eq("workspace_id", workspaceId).eq("label", label);
  // 42P01 = undefined_table — migration 20260808000001 not pushed yet.
  if (error?.code === "42P01") {
    return NextResponse.json({ error: "labels are not available yet" }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ names: await getLabelNames(supabase) });
}
