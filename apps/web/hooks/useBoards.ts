"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetLabel, Board } from "@archivemind/shared";
import { clearLegacyBoards, nextBoardColor, readLegacyBoards, splitBoards } from "@/lib/boards";

export interface BoardsApi {
  /** The live ones — the chip row. */
  boards: Board[];
  /** The trashed ones, newest deletion first: [0] is what one click of the
   *  header's restore button brings back. */
  trashedBoards: Board[];
  activeBoardId: string | null;
  activeBoard: Board | null;
  /** The active workspace's asset ids, or null when none is open. */
  scopeIds: string[] | null;
  createBoard: (name?: string, assetIds?: string[]) => void;
  renameBoard: (id: string, name: string) => void;
  /** Move to Trash — reversible, and always confirmed by the caller first. */
  deleteBoard: (id: string) => void;
  restoreBoard: (id: string) => void;
  /** Permanent, from the Trash panel only. */
  purgeBoard: (id: string) => void;
  recolorBoard: (id: string, color: AssetLabel) => void;
  selectBoard: (id: string | null) => void;
  addToBoard: (boardId: string, assetIds: string[]) => void;
}

/** Workspaces for a project (ADR 0044). Server-backed since migration
 *  `20260812000001`: seeded from the project page's own read so they are in the
 *  first paint, then every change is a request.
 *
 *  Writes are optimistic and reported through `onError` rather than rolled back
 *  — the same call `useWorkspace` makes for notes. Yanking a chip out from under
 *  a click is worse than a stale one that a reload corrects. */
export function useBoards(
  projectId: string,
  initialBoards: Board[],
  onError?: (message: string) => void,
): BoardsApi {
  // One list, live and trashed together — the reader returns them that way and a
  // delete is a stamp on a row rather than a move between two arrays, so undo
  // cannot lose one in the gap. `splitBoards` derives the two views below.
  const [boards, setBoards] = useState<Board[]>(initialBoards);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const fail = useRef(onError);
  useEffect(() => {
    fail.current = onError;
  }, [onError]);

  // Re-seed when the PROJECT changes — React's "adjust state during render"
  // pattern rather than an effect. Keyed on the project id, not on
  // `initialBoards`, because the server component hands down a fresh array on
  // every render and syncing to that would wipe an optimistic rename a beat
  // after it was typed.
  const [seededFor, setSeededFor] = useState(projectId);
  if (seededFor !== projectId) {
    setSeededFor(projectId);
    setBoards(initialBoards);
    setActiveBoardId(null);
  }

  /** One-time adoption of the workspaces this browser saved before the table
   *  existed. Cleared only after every create succeeds, so a failure retries on
   *  the next load instead of losing them. */
  useEffect(() => {
    if (projectId === "all") return;
    const legacy = readLegacyBoards(projectId);
    if (legacy.length === 0) return;
    let cancelled = false;
    void (async () => {
      const adopted: Board[] = [];
      for (const b of legacy) {
        try {
          const res = await fetch("/api/boards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId, name: b.name, color: b.color, assetIds: b.assetIds }),
          });
          if (!res.ok) return; // keep the blob; try again next load
          adopted.push((await res.json()) as Board);
        } catch {
          return;
        }
      }
      clearLegacyBoards(projectId);
      if (!cancelled && adopted.length > 0) setBoards((prev) => [...prev, ...adopted]);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const { live, trashed } = useMemo(() => splitBoards(boards), [boards]);

  const createBoard = useCallback(
    (name?: string, assetIds: string[] = []) => {
      if (projectId === "all") return;
      const body = {
        projectId,
        // Numbered and coloured against the LIVE ones: a workspace in the Trash
        // should not reserve a colour, and counting it would number the next one
        // as if it were still on screen.
        name: name?.trim() || `Workspace ${live.length + 1}`,
        color: nextBoardColor(live),
        assetIds: [...new Set(assetIds)],
      };
      void fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const saved = (await res.json()) as Board;
          setBoards((prev) => [...prev, saved]);
          // Opened only once it exists: a chip you can click before the row is
          // there would scope the canvas to an id the server has never seen.
          setActiveBoardId(saved.id);
        })
        .catch(() => fail.current?.("Couldn't create the workspace"));
    },
    [projectId, live],
  );

  const patch = useCallback((id: string, body: Record<string, unknown>, message: string) => {
    void fetch(`/api/boards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => fail.current?.(message));
  }, []);

  const renameBoard = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, name: trimmed } : b)));
      patch(id, { name: trimmed }, "Workspace not renamed");
    },
    [patch],
  );

  const recolorBoard = useCallback(
    (id: string, color: AssetLabel) => {
      setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, color } : b)));
      patch(id, { color }, "Workspace colour not saved");
    },
    [patch],
  );

  /** Move a workspace to Trash (ADR 0044 as amended). Reversible on purpose —
   *  the × that starts this sits on the chip you click to open the thing — so
   *  the row is only stamped, never removed: membership, notes and folders all
   *  stay, and `restoreBoard` is the exact inverse.
   *
   *  The stamp is optimistic and local, so the chip leaves the header and
   *  appears in the Trash on the same frame the confirmation closes; the
   *  server's own timestamp lands with the next read and is the one the sweep
   *  counts from. */
  const deleteBoard = useCallback((id: string) => {
    setBoards((prev) =>
      prev.map((b) => (b.id === id ? { ...b, deletedAt: b.deletedAt ?? new Date().toISOString() } : b)),
    );
    setActiveBoardId((cur) => (cur === id ? null : cur));
    void fetch(`/api/boards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleted: true }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => fail.current?.("Workspace not deleted"));
  }, []);

  const restoreBoard = useCallback((id: string) => {
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, deletedAt: null } : b)));
    void fetch(`/api/boards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleted: false }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => fail.current?.("Workspace not restored"));
  }, []);

  /** The irreversible one — DELETE, and only from the Trash panel. Drops the row
   *  outright rather than stamping it: membership cascades and the notes and
   *  folders made inside fall back to the project canvas (board_id null). */
  const purgeBoard = useCallback((id: string) => {
    setBoards((prev) => prev.filter((b) => b.id !== id));
    setActiveBoardId((cur) => (cur === id ? null : cur));
    void fetch(`/api/boards/${id}`, { method: "DELETE" })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => fail.current?.("Workspace not deleted"));
  }, []);

  const selectBoard = useCallback((id: string | null) => setActiveBoardId(id), []);

  const addToBoard = useCallback((id: string, assetIds: string[]) => {
    if (assetIds.length === 0) return;
    setBoards((prev) =>
      prev.map((b) => (b.id === id ? { ...b, assetIds: [...new Set([...b.assetIds, ...assetIds])] } : b)),
    );
    void fetch(`/api/boards/${id}/assets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
      })
      .catch(() => fail.current?.("Files not added to the workspace"));
  }, []);

  // Live only: a trashed workspace is not one you can be inside. `deleteBoard`
  // already clears the selection, and this is the second lock — a board that
  // arrives trashed from another tab's delete closes here too, rather than
  // leaving the canvas scoped to something that no longer has a chip.
  const activeBoard = useMemo(
    () => live.find((b) => b.id === activeBoardId) ?? null,
    [live, activeBoardId],
  );

  return {
    boards: live,
    trashedBoards: trashed,
    activeBoardId: activeBoard ? activeBoardId : null,
    activeBoard,
    scopeIds: activeBoard ? activeBoard.assetIds : null,
    createBoard,
    renameBoard,
    deleteBoard,
    restoreBoard,
    purgeBoard,
    recolorBoard,
    selectBoard,
    addToBoard,
  };
}
