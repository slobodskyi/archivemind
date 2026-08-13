import { NextResponse } from "next/server";
import { analyzeModel } from "@/lib/gemini";
import {
  contentGenerationRequestSchema,
  generateContentDraft,
  sourceAssetContextSchema,
  type SourceAssetContext,
} from "@/lib/content-generation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

interface AssetRow {
  id: string;
  title: string | null;
}

interface ExifRow {
  asset_id: string;
  taken_at: string | null;
  gps_label: string | null;
}

interface TagRow {
  asset_id: string;
  tags: { name: string } | { name: string }[] | null;
}

interface DescriptionRow {
  asset_id: string;
  content: string | null;
}

interface FactRow {
  asset_id: string;
  text: string;
}

interface CaptionRow {
  asset_id: string;
  lang: "en" | "uk" | "ru";
  style: "social" | "agency" | "archival";
  text: string;
}

function relationName(relation: TagRow["tags"]): string | null {
  if (Array.isArray(relation)) return relation[0]?.name ?? null;
  return relation?.name ?? null;
}

function grouped<T extends { asset_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const byAsset = new Map<string, T[]>();
  for (const row of rows) {
    const existing = byAsset.get(row.asset_id);
    if (existing) existing.push(row);
    else byAsset.set(row.asset_id, [row]);
  }
  return byAsset;
}

/** POST /api/content-drafts/generate — one Workspace selection → a structured
 * article or Instagram-carousel preview. This endpoint intentionally does not
 * persist: a later save/version seam owns draft rows, while retries here stay
 * side-effect free apart from the usage audit event.
 *
 * Authorization is explicit before the paid call: authenticated owner/editor
 * of the current tenant, live board in a live project, and every requested
 * active asset must be an actual member of that board. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = contentGenerationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const generationRequest = parsed.data;

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  // Generation spends money and creates publishable material, so viewer access
  // is rejected explicitly instead of relying on an unrelated table write to
  // fail after the model has already run.
  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) return NextResponse.json({ error: "authorization_unavailable" }, { status: 500 });
  if (!membership || !["owner", "editor"].includes(membership.role as string)) {
    return NextResponse.json({ error: "editor_required" }, { status: 403 });
  }

  const { data: board, error: boardError } = await supabase
    .from("boards")
    .select("id, workspace_id, project_id")
    .eq("id", generationRequest.boardId)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (boardError) return NextResponse.json({ error: "workspace_unavailable" }, { status: 500 });
  if (!board) return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });

  // Validate the board's parent instead of trusting the FK alone as an auth
  // shortcut. A board in a trashed or foreign project is not a live creation
  // scope, even if a stale client still has its id.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", board.project_id as string)
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .maybeSingle();
  if (projectError) return NextResponse.json({ error: "project_unavailable" }, { status: 500 });
  if (!project) return NextResponse.json({ error: "project_not_found" }, { status: 404 });

  const requestedIds = generationRequest.sourceAssetIds;
  const { data: membershipRows, error: boardAssetsError } = await supabase
    .from("board_assets")
    .select("asset_id")
    .eq("board_id", board.id as string)
    .in("asset_id", requestedIds);
  if (boardAssetsError) return NextResponse.json({ error: "source_membership_unavailable" }, { status: 500 });
  const boardAssetIds = new Set((membershipRows ?? []).map((row) => row.asset_id as string));
  if (requestedIds.some((assetId) => !boardAssetIds.has(assetId))) {
    return NextResponse.json({ error: "source_assets_not_found" }, { status: 404 });
  }

  // Fetch each evidence class separately. This makes the safety boundary
  // visible in the query itself: facts are confirmed-only and captions are
  // human-edited-only; no broad nested relation can smuggle another status into
  // the prompt through a mapping bug.
  const [assetsResult, exifResult, tagsResult, descriptionsResult, factsResult, captionsResult] =
    await Promise.all([
      supabase
        .from("assets")
        .select("id, title")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .in("id", requestedIds),
      supabase.from("asset_exif").select("asset_id, taken_at, gps_label").in("asset_id", requestedIds),
      supabase.from("asset_tags").select("asset_id, tags ( name )").in("asset_id", requestedIds),
      supabase
        .from("embeddings")
        .select("asset_id, content")
        .in("asset_id", requestedIds)
        .eq("kind", "image")
        .eq("chunk_index", 0),
      supabase
        .from("facts")
        .select("asset_id, text")
        .in("asset_id", requestedIds)
        .eq("status", "confirmed")
        .order("created_at", { ascending: true }),
      supabase
        .from("captions")
        .select("asset_id, lang, style, text")
        .in("asset_id", requestedIds)
        .eq("lang", generationRequest.language)
        .eq("is_edited", true)
        .order("updated_at", { ascending: false }),
    ]);

  const metadataError = [
    assetsResult.error,
    exifResult.error,
    tagsResult.error,
    descriptionsResult.error,
    factsResult.error,
    captionsResult.error,
  ].find((error) => error !== null);
  if (metadataError) return NextResponse.json({ error: "source_metadata_unavailable" }, { status: 500 });

  const assets = (assetsResult.data ?? []) as unknown as AssetRow[];
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  // This is the active-status half of the authorization check. Do it after the
  // board membership check and before Gemini, with one undifferentiated 404 so
  // foreign/deleted ids are not an existence oracle.
  if (requestedIds.some((assetId) => !assetsById.has(assetId))) {
    return NextResponse.json({ error: "source_assets_not_found" }, { status: 404 });
  }

  const exifByAsset = new Map(
    ((exifResult.data ?? []) as unknown as ExifRow[]).map((row) => [row.asset_id, row]),
  );
  const tagsByAsset = grouped((tagsResult.data ?? []) as unknown as TagRow[]);
  const descriptionsByAsset = new Map(
    ((descriptionsResult.data ?? []) as unknown as DescriptionRow[]).map((row) => [row.asset_id, row.content]),
  );
  const factsByAsset = grouped((factsResult.data ?? []) as unknown as FactRow[]);
  const captionsByAsset = grouped((captionsResult.data ?? []) as unknown as CaptionRow[]);

  // Map over request ids — never database order. The user's editorial ordering
  // is meaningful and must survive both PostgREST and the model prompt.
  const sources: SourceAssetContext[] = requestedIds.map((assetId) => {
    const asset = assetsById.get(assetId);
    if (!asset) throw new Error("active source disappeared while building generation context");
    const exif = exifByAsset.get(assetId);
    return sourceAssetContextSchema.parse({
      id: assetId,
      title: asset.title,
      takenAt: exif?.taken_at ?? null,
      location: exif?.gps_label ?? null,
      tags: [
        ...new Set(
          (tagsByAsset.get(assetId) ?? [])
            .map((row) => relationName(row.tags))
            .filter((name): name is string => name !== null),
        ),
      ]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 20),
      description: descriptionsByAsset.get(assetId) ?? null,
      confirmedFacts: (factsByAsset.get(assetId) ?? []).map((row) => row.text).slice(0, 12),
      editedCaptions: (captionsByAsset.get(assetId) ?? []).slice(0, 3).map((row) => ({
        language: row.lang,
        style: row.style,
        text: row.text,
      })),
    });
  });

  let content;
  try {
    content = await generateContentDraft(generationRequest, sources);
  } catch (error) {
    // Do not log the prompt or model response: both contain user archive data.
    console.error("Content draft generation failed", error instanceof Error ? error.name : "unknown_error");
    return NextResponse.json({ error: "generation_failed" }, { status: 502 });
  }

  const model = analyzeModel();
  // `usage_events.event_type` is text, so the audit can land without a schema
  // migration. This is one multi-photo publication call (`units: 1`). The
  // shared credit/cost contract intentionally remains unchanged in this slice:
  // until a product decision prices multi-photo generation, unknown events are
  // 0 credits and cost_usd stays null rather than inventing a charge.
  const { error: usageError } = await supabase.from("usage_events").insert({
    workspace_id: workspaceId,
    user_id: user.id,
    event_type: "content_generated",
    units: 1,
    model,
    cost_usd: null,
  });
  if (usageError) console.warn("Content generation usage event was not recorded");

  return NextResponse.json({ content, model });
}
