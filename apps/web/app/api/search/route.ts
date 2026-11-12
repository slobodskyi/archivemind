import { NextResponse } from "next/server";
import { searchResponseSchema, uuidSchema, type SearchParse } from "@archivemind/shared";
import { parseSearchQuery } from "@/lib/gemini";
import { runSearch, semanticOnlyParse } from "@/lib/search-server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** No UI caller since the chat moved to `POST /api/assistant` (ADR 0056's
 *  amendment), which runs this same pipeline with an intent attached. Kept as
 *  the spec's search endpoint.
 *
 *  GET /api/search?q=&projectId= (spec §8.4, issue #15): Gemini parses the
 *  query into filters, the query text is embedded into the worker's image
 *  space (cross-modal — verified against official docs, issue #35), and
 *  search_assets() ranks by cosine + tag boost under the caller's RLS. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ error: "q must be at least 2 characters" }, { status: 400 });
  const projectId = searchParams.get("projectId");
  if (projectId && !uuidSchema.safeParse(projectId).success) {
    return NextResponse.json({ error: "invalid projectId" }, { status: 400 });
  }

  // Model hiccups degrade to pure semantic search — never a failed request.
  const today = new Date().toISOString().slice(0, 10);
  let parsed: SearchParse;
  try {
    parsed = await parseSearchQuery(q, today);
  } catch {
    parsed = semanticOnlyParse(q);
  }

  // Embed → search_assets() → usage event → tiers: lib/search-server, shared
  // with POST /api/assistant.
  const outcome = await runSearch(supabase, { workspaceId, userId: user.id, projectId, parsed, q });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json(searchResponseSchema.parse({ parsed, results: outcome.results }));
}
