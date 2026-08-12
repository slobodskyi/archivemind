"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetLabel, Board } from "@archivemind/shared";
import { clearLegacyBoards, nextBoardColor, readLegacyBoards } from "@/lib/boards";

export interface BoardsApi {
  boards: Board[];
  activeBoardId: string | null;
  activeBoard: Board | null;
  /** The active workspace's asset ids, or null when none is open. */
  scopeIds: string[] | null;
  createBoard: (name?: string, assetIds?: string[]) => void;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => void;
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

  const createBoard = useCallback(
    (name?: string, assetIds: string[] = []) => {
      if (projectId === "all") return;
      const body = {
        projectId,
        name: name?.trim() || `Workspace ${boards.length + 1}`,
        color: nextBoardColor(boards),
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
    [projectId, boards],
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

  const deleteBoard = useCallback((id: string) => {
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

  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? null,
    [boards, activeBoardId],
  );

  return {
    boards,
    activeBoardId,
    activeBoard,
    scopeIds: activeBoard ? activeBoard.assetIds : null,
    createBoard,
    renameBoard,
    deleteBoard,
    recolorBoard,
    selectBoard,
    addToBoard,
  };
}
