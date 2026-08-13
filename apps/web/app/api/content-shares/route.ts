import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { copyObject, deleteObject } from "@/lib/r2";
import {
  createPublicationShareRequestSchema,
  createPublicationShareResponseSchema,
  createPublicationSnapshot,
  listPublicationSharesResponseSchema,
  publicationPreviewDimensions,
} from "@/lib/publication-shares";
import { usedAssetIds } from "@/lib/content-package";
import { createClient } from "@/lib/supabase/server";

interface AssetRow {
  id: string;
  title: string | null;
  status: string;
}

interface PreviewRow {
  asset_id: string;
  r2_key: string;
  width: number | null;
  height: number | null;
}

interface EditRow {
  asset_id: string;
  edited_medium_key: string | null;
  recipe: unknown;
}

interface FileRow {
  asset_id: string;
  r2_key: string | null;
  mime_type: string | null;
  created_at: string;
}

const createdShareRowSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  copy_plan: z.array(z.object({
    publicId: z.string().uuid(),
    sourceR2Key: z.string().min(1),
    destinationR2Key: z.string().min(1),
  })).max(20),
});

function downloadFilename(filename: string, web: boolean): string {
  const value = filename.trim().slice(0, 480) || "photo";
  if (!web) return value;
  const dot = value.lastIndexOf(".");
  return `${dot > 0 ? value.slice(0, dot) : value}.webp`;
}

const listedShareRowSchema = z.object({
  id: z.string().uuid(),
  source_draft_id: z.string().trim().min(1).max(200),
  kind: z.enum(["article", "instagram_carousel"]),
  name: z.string().min(1).max(160),
  status: z.enum(["preparing", "ready", "revoked"]),
  allow_downloads: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).nullable(),
});

function rpcFailure(error: { code?: string; message?: string }) {
  // Raw snapshots and bearer tokens are deliberately absent from this log.
  console.error("publication share RPC failed", { code: error.code ?? "unknown" });
  if (error.code === "42501") return NextResponse.json({ error: "editor_required" }, { status: 403 });
  if (error.code === "P0002") return NextResponse.json({ error: "workspace_not_found" }, { status: 404 });
  if (error.code === "22023") return NextResponse.json({ error: "invalid_share" }, { status: 400 });
  return NextResponse.json({ error: "share_unavailable" }, { status: 500 });
}

/** GET /api/content-shares?boardId= — every manageable/history row for this
 * Workspace. Drafts are browser-local, so the board-wide list deliberately
 * includes links whose source draft has since disappeared from localStorage.
 * The bearer address remains hash-only and is never returned. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const boardId = url.searchParams.get("boardId") ?? "";
  if (!z.string().uuid().safeParse(boardId).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("list_publication_shares", {
    p_board_id: boardId,
  });
  if (error) return rpcFailure(error);

  const rows = z.array(listedShareRowSchema).max(100).safeParse(data ?? []);
  if (!rows.success) return NextResponse.json({ error: "share_unavailable" }, { status: 500 });

  const body = listPublicationSharesResponseSchema.parse({
    shares: rows.data.map((row) => ({
      shareId: row.id,
      sourceDraftId: row.source_draft_id,
      kind: row.kind,
      name: row.name,
      status: row.status,
      allowDownloads: row.allow_downloads,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
  return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST /api/content-shares — freeze the current browser-local draft into one
 * server-owned public version. The RPC validates tenancy/membership atomically;
 * the route then copies each current medium to the trusted share key and only
 * activates the link after every copy succeeds. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = createPublicationShareRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { draft, options } = parsed.data;
  const assetIds = usedAssetIds(draft);
  if (assetIds.length > 20) return NextResponse.json({ error: "too_many_assets" }, { status: 400 });

  const [assetResult, previewResult, editResult, fileResult] = assetIds.length === 0
    ? [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ]
    : await Promise.all([
        supabase.from("assets").select("id, title, status").in("id", assetIds).eq("status", "active"),
        supabase.from("asset_previews").select("asset_id, r2_key, width, height").in("asset_id", assetIds).eq("size", "medium"),
        supabase.from("asset_edits").select("asset_id, edited_medium_key, recipe").in("asset_id", assetIds),
        supabase.from("files").select("asset_id, r2_key, mime_type, created_at").in("asset_id", assetIds).order("created_at", { ascending: true }),
      ]);
  if (assetResult.error || previewResult.error || editResult.error || fileResult.error) {
    return NextResponse.json({ error: "source_unavailable" }, { status: 500 });
  }

  const assetsById = new Map(((assetResult.data ?? []) as AssetRow[]).map((asset) => [asset.id, asset]));
  const previewsById = new Map(((previewResult.data ?? []) as PreviewRow[]).map((preview) => [preview.asset_id, preview]));
  const editsById = new Map(((editResult.data ?? []) as EditRow[]).map((edit) => [edit.asset_id, edit]));
  const filesByAsset = new Map<string, FileRow[]>();
  for (const file of (fileResult.data ?? []) as FileRow[]) {
    const rows = filesByAsset.get(file.asset_id) ?? [];
    rows.push(file);
    filesByAsset.set(file.asset_id, rows);
  }

  if (assetIds.some((assetId) => !assetsById.has(assetId) || !previewsById.has(assetId))) {
    return NextResponse.json({ error: "media_not_ready" }, { status: 409 });
  }

  const publicIdsByAssetId = new Map(assetIds.map((assetId) => [assetId, crypto.randomUUID()]));
  const snapshot = createPublicationSnapshot(draft, publicIdsByAssetId);
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 1_000_000) {
    return NextResponse.json({ error: "snapshot_too_large" }, { status: 400 });
  }

  const shareAssets = assetIds.map((assetId, position) => {
    const asset = assetsById.get(assetId);
    const preview = previewsById.get(assetId);
    if (!asset || !preview) throw new Error("validated share asset disappeared");
    const filename = asset.title?.trim().slice(0, 500) || `photo-${position + 1}.webp`;
    const original = (filesByAsset.get(assetId) ?? []).find((file) => Boolean(file.r2_key));
    const isOriginal = Boolean(original?.r2_key);
    const edit = editsById.get(assetId);
    const dimensions = edit?.edited_medium_key
      ? publicationPreviewDimensions(preview.width, preview.height, edit.recipe)
      : { width: preview.width, height: preview.height };
    return {
      assetId,
      publicId: publicIdsByAssetId.get(assetId),
      position,
      filename,
      width: dimensions.width,
      height: dimensions.height,
      previewR2Key: edit?.edited_medium_key ?? preview.r2_key,
      downloadR2Key: original?.r2_key ?? null,
      downloadFilename: downloadFilename(filename, !isOriginal),
      downloadMimeType: isOriginal ? (original?.mime_type ?? "application/octet-stream") : "image/webp",
      downloadQuality: isOriginal ? "original" : "web_1024",
    };
  });

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = options.expiresInDays === null
    ? null
    : new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .rpc("create_publication_share", {
      p_board_id: draft.boardId,
      p_source_draft_id: draft.id,
      p_kind: draft.kind,
      p_name: draft.name,
      p_snapshot: snapshot,
      p_token_hash: tokenHash,
      p_expires_at: expiresAt,
      p_allow_downloads: options.allowDownloads,
      p_assets: shareAssets,
    })
    .single();
  if (error) return rpcFailure(error);
  const created = createdShareRowSchema.safeParse(data);
  if (!created.success || created.data.copy_plan.length !== shareAssets.length) {
    return NextResponse.json({ error: "share_unavailable" }, { status: 500 });
  }

  try {
    // Wait for every copy to settle before cleanup. Promise.all would reject on
    // the first failure while a slower copy could still finish after deletion,
    // leaving an untracked share-owned object behind.
    const copies = await Promise.allSettled(
      created.data.copy_plan.map((item) => copyObject(item.sourceR2Key, item.destinationR2Key)),
    );
    if (copies.some((copy) => copy.status === "rejected")) throw new Error("copy_failed");
    const { data: activated, error: activationError } = await supabase.rpc("activate_publication_share", {
      p_share_id: created.data.id,
    });
    if (activationError || activated !== true) throw new Error("activation_failed");
  } catch (error) {
    console.error("publication share media copy failed", {
      name: error instanceof Error ? error.name : "unknown_error",
      files: created.data.copy_plan.length,
    });
    await supabase.rpc("revoke_publication_share", { p_share_id: created.data.id });
    await Promise.allSettled(created.data.copy_plan.map((item) => deleteObject(item.destinationR2Key)));
    return NextResponse.json({ error: "share_media_failed" }, { status: 502 });
  }

  const body = createPublicationShareResponseSchema.parse({
    shareId: created.data.id,
    path: `/p/${token}`,
    createdAt: created.data.created_at,
    expiresAt: created.data.expires_at,
  });
  return NextResponse.json(body, {
    status: 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}
