import { NextResponse } from "next/server";
import { noteBodySchema } from "@archivemind/shared";
import { analyzeModel } from "@/lib/gemini";
import {
  contentGenerationRequestSchema,
  generateContentDraft,
  sourceAssetContextSchema,
  type SourceAssetContext,
} from "@/lib/content-generation";
import { flattenNoteEvidenceText } from "@/lib/notes";
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

interface EdgeRow {
  from_asset_id: string | null;
  from_annotation_id: string | null;
  to_asset_id: string | null;
  to_annotation_id: string | null;
}

/** The note's jsonb body → its prompt text. Parsing and the strike-drop rule
 *  live in lib/notes.ts (flattenNoteEvidenceText), where they are pure and
 *  unit-tested; this only unwraps the jsonb. */
function flattenNoteText(rawBody: unknown): string {
  const body = noteBodySchema.safeParse(rawBody ?? {});
  if (!body.success) return "";
  return flattenNoteEvidenceText(body.data.text);
}

const pairKey = (a: string, b: string) => [a, b].sort().join(":");

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
  const [assetsResult, exifResult, tagsResult, descriptionsResult, factsResult, captionsResult, edgesResult] =
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
      // The board's edges (ADR 0048): note↔photo wires become authorNotes, and
      // photo↔photo pairs verify the client's orderIsAuthored claim.
      supabase
        .from("canvas_edges")
        .select("from_asset_id, from_annotation_id, to_asset_id, to_annotation_id")
        .eq("board_id", board.id as string)
        .order("created_at", { ascending: true }),
    ]);

  // Edges degrade like their reader does: the table may not be migrated yet
  // (42P01/42703), and generation must keep working without the feature rather
  // than 500 on every board.
  const edgeRows =
    edgesResult.error?.code === "42P01" || edgesResult.error?.code === "42703"
      ? []
      : ((edgesResult.data ?? []) as unknown as EdgeRow[]);
  const edgesError =
    edgesResult.error && edgesResult.error.code !== "42P01" && edgesResult.error.code !== "42703"
      ? edgesResult.error
      : null;

  const metadataError = [
    assetsResult.error,
    exifResult.error,
    tagsResult.error,
    descriptionsResult.error,
    factsResult.error,
    captionsResult.error,
    edgesError,
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

  // ── Edges (ADR 0048): note context and the authored-order check ──────────
  // note↔photo wires map each asset to its note ids (either direction, in
  // edge creation order); photo↔photo pairs feed the orderIsAuthored proof.
  const noteIdsByAsset = new Map<string, string[]>();
  const assetPairKeys = new Set<string>();
  const wiredNoteIds = new Set<string>();
  for (const row of edgeRows) {
    if (row.from_asset_id && row.to_asset_id) {
      assetPairKeys.add(pairKey(row.from_asset_id, row.to_asset_id));
      continue;
    }
    const assetId = row.from_asset_id ?? row.to_asset_id;
    const annotationId = row.from_annotation_id ?? row.to_annotation_id;
    if (!assetId || !annotationId) continue;
    wiredNoteIds.add(annotationId);
    const list = noteIdsByAsset.get(assetId);
    if (list) list.push(annotationId);
    else noteIdsByAsset.set(assetId, [annotationId]);
  }

  // The notes' bodies, board-owned only. Assembled HERE and never accepted
  // from the request: this is the first author-written per-asset text to reach
  // the prompt, and deriving it server-side is what proves the note belongs to
  // the board being generated from (ADR 0045 as amended).
  const noteTextById = new Map<string, string>();
  if (wiredNoteIds.size > 0) {
    const { data: noteRows, error: notesError } = await supabase
      .from("canvas_annotations")
      .select("id, body")
      .in("id", [...wiredNoteIds])
      .eq("board_id", board.id as string)
      .eq("kind", "note");
    if (notesError) return NextResponse.json({ error: "source_metadata_unavailable" }, { status: 500 });
    for (const row of (noteRows ?? []) as { id: string; body: unknown }[]) {
      const text = flattenNoteText(row.body);
      if (text) noteTextById.set(row.id, text);
    }
  }
  const authorNotesFor = (assetId: string): string[] =>
    (noteIdsByAsset.get(assetId) ?? [])
      .map((noteId) => noteTextById.get(noteId))
      .filter((text): text is string => Boolean(text))
      .slice(0, 3);

  // orderIsAuthored is client-claimed but verified against the drawn thread:
  // every consecutive pair must be joined by an asset↔asset edge on this
  // board, or the flag silently drops — a stale client must not be able to
  // caption arbitrary order as authored.
  const orderIsAuthored =
    generationRequest.orderIsAuthored &&
    requestedIds.length >= 2 &&
    requestedIds.every(
      (assetId, index) => index === 0 || assetPairKeys.has(pairKey(requestedIds[index - 1], assetId)),
    );
  const verifiedRequest = { ...generationRequest, orderIsAuthored };

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
      authorNotes: authorNotesFor(assetId),
    });
  });

  let content;
  try {
    content = await generateContentDraft(verifiedRequest, sources);
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
