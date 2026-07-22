import { NextResponse } from "next/server";
import { searchResponseSchema, uuidSchema, type SearchParse } from "@archivemind/shared";
import { analyzeModel, embedText, parseSearchQuery } from "@/lib/gemini";
import { assignTiers } from "@/lib/search-tiers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

interface SearchRow {
  asset_id: string;
  similarity: number;
  matched_tags: string[];
  matched_place: string | null;
  taken_at: string | null;
}

/** GET /api/search?q=&projectId= (spec §8.4, issue #15): Gemini parses the
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
    parsed = { semantic_text: q, date_from: null, date_to: null, place_terms: [], tag_terms: [], kinds: [] };
  }

  let embedding: number[];
  try {
    embedding = await embedText(parsed.semantic_text.trim() || q);
  } catch {
    return NextResponse.json({ error: "embedding unavailable — try again" }, { status: 502 });
  }

  const { data, error } = await supabase.rpc("search_assets", {
    query_embedding: JSON.stringify(embedding),
    ws: workspaceId,
    proj: projectId ?? undefined,
    date_from: parsed.date_from ?? undefined,
    date_to: parsed.date_to ?? undefined,
    place_terms: parsed.place_terms.length ? parsed.place_terms.map((t) => t.toLowerCase()) : undefined,
    tag_terms: parsed.tag_terms.length ? parsed.tag_terms.map((t) => t.toLowerCase()) : undefined,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Spec §8.4: every search logs usage. Non-fatal — a metering hiccup must
  // not fail the search itself.
  await supabase.from("usage_events").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    event_type: "search_query",
    units: 1,
    model: analyzeModel(),
  });

  // The RPC returns a ranked list with no cutoff; the tier annotation (ADR
  // 0029) is what keeps a small archive from answering every query with all
  // of itself. Order is preserved — tag-matched rows already rank first.
  const rows = (data ?? []) as SearchRow[];
  const results = assignTiers(
    rows.map((r) => ({
      assetId: r.asset_id,
      similarity: r.similarity,
      matchedTags: r.matched_tags ?? [],
      matchedPlace: r.matched_place,
      takenAt: r.taken_at,
    })),
  );
  return NextResponse.json(searchResponseSchema.parse({ parsed, results }));
}
