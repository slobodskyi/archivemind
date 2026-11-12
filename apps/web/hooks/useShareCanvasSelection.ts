"use client";

import { useEffect, useRef } from "react";
import { shareAssetIdsResponseSchema } from "@/lib/project-shares";
import {
  shareCanvasEndpoint,
  shareCanvasScope,
  withoutShareCanvasParams,
  type ShareCanvasRequest,
} from "@/lib/share-canvas";

/** "Show on canvas" for a project share link (ADR 0051 §12, ADR 0053 §6):
 *  put the canvas on the link's scope, ask which files it carries (`?share=`)
 *  or brought in (`?received=`), select them, then drop the keys from the
 *  address so a reload does not select them again.
 *
 *  `select` is the canvas's own select-these-ids action, which keeps only the
 *  ids loaded on this canvas and toasts how many it found. `openScope` opens a
 *  Workspace (or, with null, the whole project); a Workspace link opens its
 *  own first, so what it carries is what is drawn. `boardIds` are the
 *  Workspaces this canvas can open — a link whose Workspace is in Trash falls
 *  back to the project. */
export function useShareCanvasSelection(
  request: ShareCanvasRequest | null,
  select: (ids: string[]) => void,
  openScope: (boardId: string | null) => void,
  boardIds: readonly string[],
): void {
  // Read at fire time: these change identity with every board edit, and the
  // effect must run once per request, not once per rename.
  const latest = useRef({ select, openScope, boardIds });
  useEffect(() => {
    latest.current = { select, openScope, boardIds };
  });

  // Primitives as deps: the request object is rebuilt on every server render.
  const kind = request?.kind ?? null;
  const shareId = request?.shareId ?? null;
  const boardId = request?.kind === "scope" ? request.boardId : null;
  const at = request?.at ?? null;

  useEffect(() => {
    if (!kind || !shareId) return;
    const current: ShareCanvasRequest = kind === "scope" ? { kind, shareId, boardId } : { kind, shareId };
    let live = true;
    const scope = shareCanvasScope(current, latest.current.boardIds);
    if (scope !== undefined) latest.current.openScope(scope);
    void (async () => {
      try {
        const response = await fetch(shareCanvasEndpoint(current), { cache: "no-store" });
        if (!response.ok) return;
        const body = shareAssetIdsResponseSchema.safeParse(await response.json());
        if (live && body.success) latest.current.select(body.data.assetIds);
      } catch {
        // Selection is a convenience: the canvas is already open either way.
      } finally {
        // Next integrates native history calls with its router.
        if (live) window.history.replaceState(null, "", withoutShareCanvasParams(window.location.href));
      }
    })();
    return () => {
      live = false;
    };
    // `at` is read only as a dependency: a new click re-runs the same request.
  }, [kind, shareId, boardId, at]);
}
