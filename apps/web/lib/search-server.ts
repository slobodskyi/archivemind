import type { SupabaseClient } from "@supabase/supabase-js";
import { costUsdFor, type SearchParse, type SearchResult } from "@archivemind/shared";
import { analyzeModel, embedText } from "@/lib/gemini";
import { assignTiers } from "@/lib/search-tiers";

/** The search pipeline after the parse (spec §8.4): embed → `search_assets()`
 *  under the caller's RLS → usage event → relevance tiers. Shared by
 *  `GET /api/search` and `POST /api/assistant`, which differ only in how they
 *  obtain the parse — the assistant's comes with an intent attached. */

interface SearchRow {
  asset_id: string;
  similarity: number;
  matched_tags: string[];
  matched_place: string | null;
  matched_text: boolean;
  taken_at: string | null;
}

/** The parse a model hiccup degrades to: pure semantic search on the raw text. */
export function semanticOnlyParse(q: string): SearchParse {
  return {
    semantic_text: q,
    date_from: null,
    date_to: null,
    place_terms: [],
    tag_terms: [],
    camera_terms: [],
    iso_min: null,
    iso_max: null,
    aperture: null,
    kinds: [],
  };
}

export type SearchOutcome =
  | { ok: true; results: SearchResult[] }
  | { ok: false; status: 500 | 502; error: string };

export async function runSearch(
  supabase: SupabaseClient,
  opts: { workspaceId: string; userId: string; projectId: string | null; parsed: SearchParse; q: string },
): Promise<SearchOutcome> {
  const { workspaceId, userId, projectId, parsed, q } = opts;
  const text = parsed.semantic_text.trim() || q;

  let embedding: number[];
  try {
    embedding = await embedText(text);
  } catch {
    return { ok: false, status: 502, error: "embedding unavailable — try again" };
  }

  const { data, error } = await supabase.rpc("search_assets", {
    query_embedding: JSON.stringify(embedding),
    ws: workspaceId,
    proj: projectId ?? undefined,
    date_from: parsed.date_from ?? undefined,
    date_to: parsed.date_to ?? undefined,
    place_terms: parsed.place_terms.length ? parsed.place_terms.map((t) => t.toLowerCase()) : undefined,
    tag_terms: parsed.tag_terms.length ? parsed.tag_terms.map((t) => t.toLowerCase()) : undefined,
    // Lexical hybrid (ADR 0031): the same text we embed is also matched against
    // each asset's AI description + facts. EXIF filters narrow the set.
    text_query: text,
    camera_terms: parsed.camera_terms.length ? parsed.camera_terms.map((t) => t.toLowerCase()) : undefined,
    iso_min: parsed.iso_min ?? undefined,
    iso_max: parsed.iso_max ?? undefined,
    aperture_term: parsed.aperture ?? undefined,
  });
  if (error) return { ok: false, status: 500, error: error.message };

  // Spec §8.4: every search logs usage. Non-fatal — a metering hiccup must
  // not fail the search itself.
  await supabase.from("usage_events").insert({
    workspace_id: workspaceId,
    user_id: userId,
    event_type: "search_query",
    units: 1,
    model: analyzeModel(),
    // Costs us two model calls (parse + embed) and the user 0 credits —
    // search is the core loop (packages/shared CREDIT_COST).
    cost_usd: costUsdFor("search_query", 1),
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
      matchedText: r.matched_text ?? false,
      takenAt: r.taken_at,
    })),
  );
  return { ok: true, results };
}
