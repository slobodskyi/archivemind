import { NextResponse } from "next/server";
import { z } from "zod";
import { contentDraftSchema, parseContentDraft } from "@/lib/content-drafts";
import { createClient } from "@/lib/supabase/server";

/** Durable content drafts (ADR 0045 amendment, migration 20260814000001).
 *
 * The browser still writes `localStorage` first — the editor's save path is
 * synchronous and typing must not wait on a network — and mirrors here. This
 * route is the durable copy of record, so clearing site data stops destroying
 * the text somebody wrote. */

const boardIdSchema = z.string().uuid();

const savedRowSchema = z.object({
  draft_id: z.string().uuid(),
  draft_client_id: z.string().min(1).max(200),
  draft_version: z.number().int().positive(),
  draft_updated_at: z.string().datetime({ offset: true }),
  is_stale: z.boolean(),
});

const storedRowSchema = z.object({
  client_id: z.string().min(1).max(200),
  version: z.number().int().positive(),
  updated_at: z.string().datetime({ offset: true }),
  document: z.unknown(),
});

function rpcFailure(error: { code?: string }) {
  console.error("content draft RPC failed", { code: error.code ?? "unknown" });
  if (error.code === "42501") return NextResponse.json({ error: "editor_required" }, { status: 403 });
  if (error.code === "22023") return NextResponse.json({ error: "invalid_draft" }, { status: 400 });
  return NextResponse.json({ error: "draft_unavailable" }, { status: 500 });
}

/** GET /api/content-drafts?boardId= — every live draft of one Workspace.
 *  Returns the stored envelope verbatim so the client parses it with the same
 *  zod schema it uses for its local copy; a row that no longer satisfies that
 *  schema is dropped rather than allowed to break the Drafts menu. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const boardId = new URL(request.url).searchParams.get("boardId") ?? "";
  if (!boardIdSchema.safeParse(boardId).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("content_drafts")
    .select("client_id, version, updated_at, document")
    .eq("board_id", boardId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "draft_unavailable" }, { status: 500 });

  const drafts = (data ?? []).flatMap((row) => {
    const parsedRow = storedRowSchema.safeParse(row);
    if (!parsedRow.success) return [];
    const draft = parseContentDraft(parsedRow.data.document);
    return draft ? [{ version: parsedRow.data.version, updatedAt: parsedRow.data.updated_at, draft }] : [];
  });

  return NextResponse.json({ drafts }, { headers: { "Cache-Control": "private, no-store" } });
}

/** PUT /api/content-drafts — upsert one draft, keyed by the browser's own id.
 *  `stale: true` means a newer version is already stored (a second tab): the
 *  caller is told rather than having its older envelope silently win. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const parsed = z
    .object({ boardId: boardIdSchema, draft: contentDraftSchema })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  }
  const { boardId, draft } = parsed.data;
  if (draft.boardId !== boardId) {
    return NextResponse.json({ error: "board_mismatch" }, { status: 400 });
  }

  const { data, error } = await supabase
    .rpc("save_content_draft", {
      p_board_id: boardId,
      p_client_id: draft.id,
      p_kind: draft.kind,
      p_name: draft.name,
      p_document: draft,
      p_version: draft.version,
    })
    .single();
  if (error) return rpcFailure(error);

  const saved = savedRowSchema.safeParse(data);
  if (!saved.success) return NextResponse.json({ error: "draft_unavailable" }, { status: 500 });

  return NextResponse.json(
    {
      clientId: saved.data.draft_client_id,
      version: saved.data.draft_version,
      updatedAt: saved.data.draft_updated_at,
      stale: saved.data.is_stale,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** DELETE /api/content-drafts?boardId=&draftId= — soft delete, so an Undo can
 *  bring the same draft id back (and with it the link any publication made
 *  from it still refers to). */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const boardId = params.get("boardId") ?? "";
  const draftId = params.get("draftId") ?? "";
  if (!boardIdSchema.safeParse(boardId).success || draftId.length < 1 || draftId.length > 200) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { error } = await supabase
    .from("content_drafts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("board_id", boardId)
    .eq("client_id", draftId)
    .is("deleted_at", null);
  if (error) return NextResponse.json({ error: "draft_unavailable" }, { status: 500 });

  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
}
