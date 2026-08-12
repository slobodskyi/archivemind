"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Board, BoardObjectKind } from "@/lib/boards";
import { loadBoards, saveBoards, nextBoardColor, ownedKey } from "@/lib/boards";

/** Local ids for a board — a real uuid where available, a timestamp fallback on
 *  non-secure origins where `crypto.randomUUID` is undefined (same guard as
 *  `lib/upload-client.ts`). Boards are client-only until ADR 0044's table lands. */
function boardId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `board-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** What `useWorkspace` reports when a canvas object is made, saved or removed,
 *  so the open workspace can record what belongs to it. `adopt` exists for the
 *  one object with two ids in its life: a sticky note is drawn under a `tmp-`
 *  id and gets its row's uuid when the insert returns. */
export type BoardObjectEvent =
  | { type: "create"; kind: BoardObjectKind; id: string }
  | { type: "adopt"; kind: BoardObjectKind; from: string; to: string }
  | { type: "delete"; kind: BoardObjectKind; id: string };

export interface BoardsApi {
  boards: Board[];
  activeBoardId: string | null;
  activeBoard: Board | null;
  /** The active board's ids, or null when none is open (sorting mode). */
  scopeIds: string[] | null;
  createBoard: (name?: string, assetIds?: string[]) => string;
  renameBoard: (id: string, name: string) => void;
  deleteBoard: (id: string) => void;
  recolorBoard: (id: string, color: Board["color"]) => void;
  selectBoard: (id: string | null) => void;
  addToBoard: (boardId: string, assetIds: string[]) => void;
  /** Record a canvas object against the OPEN workspace (a no-op when none is).
   *  Deletes and adopts run over every board, not just the open one: an object
   *  can be removed while you are looking somewhere else. */
  onCanvasObject: (event: BoardObjectEvent) => void;
  /** The ids the open workspace owns, or null when none is open (show all). */
  ownedIds: Record<BoardObjectKind, ReadonlySet<string>> | null;
}

/** Workspaces (boards) for a project — the entity that replaced artboards
 *  (ADR 0044). CRUD + `localStorage` persistence, deliberately separate from the
 *  6k-line `useWorkspace`: a board is just a named colour-coded file set, and its
 *  only tie into the canvas is the `scopeIds` it hands back. */
export function useBoards(projectId: string): BoardsApi {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  // Skip the first save (the load effect sets state); only persist real edits.
  const hydrated = useRef(false);

  useEffect(() => {
    // Hydrate from localStorage after mount (server render starts empty so the
    // first client render matches), and reset the open board when the project
    // changes. Same post-mount setState the canvas store does.
    hydrated.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoards(loadBoards(projectId));
    setActiveBoardId(null);
  }, [projectId]);

  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    saveBoards(projectId, boards);
  }, [projectId, boards]);

  const createBoard = useCallback(
    (name?: string, assetIds: string[] = []) => {
      const id = boardId();
      setBoards((prev) => [
        ...prev,
        {
          id,
          name: name?.trim() || `Workspace ${prev.length + 1}`,
          color: nextBoardColor(prev),
          assetIds: [...new Set(assetIds)],
          noteIds: [],
          groupIds: [],
          frameIds: [],
        },
      ]);
      setActiveBoardId(id);
      return id;
    },
    [],
  );

  const renameBoard = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, name: trimmed } : b)));
  }, []);

  const recolorBoard = useCallback((id: string, color: Board["color"]) => {
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, color } : b)));
  }, []);

  const deleteBoard = useCallback((id: string) => {
    setBoards((prev) => prev.filter((b) => b.id !== id));
    setActiveBoardId((cur) => (cur === id ? null : cur));
  }, []);

  const selectBoard = useCallback((id: string | null) => setActiveBoardId(id), []);

  const addToBoard = useCallback((id: string, assetIds: string[]) => {
    setBoards((prev) =>
      prev.map((b) => (b.id === id ? { ...b, assetIds: [...new Set([...b.assetIds, ...assetIds])] } : b)),
    );
  }, []);

  const onCanvasObject = useCallback((event: BoardObjectEvent) => {
    const key = ownedKey(event.kind);
    setBoards((prev) => {
      if (event.type === "create") {
        // Only the open workspace claims new objects; with none open the object
        // belongs to the project and shows everywhere.
        if (activeBoardId === null) return prev;
        return prev.map((b) =>
          b.id === activeBoardId && !b[key].includes(event.id)
            ? { ...b, [key]: [...b[key], event.id] }
            : b,
        );
      }
      if (event.type === "adopt") {
        return prev.map((b) =>
          b[key].includes(event.from)
            ? { ...b, [key]: b[key].map((id) => (id === event.from ? event.to : id)) }
            : b,
        );
      }
      return prev.map((b) =>
        b[key].includes(event.id) ? { ...b, [key]: b[key].filter((id) => id !== event.id) } : b,
      );
    });
  }, [activeBoardId]);

  const activeBoard = useMemo(() => boards.find((b) => b.id === activeBoardId) ?? null, [boards, activeBoardId]);

  const ownedIds = useMemo(
    () =>
      activeBoard
        ? {
            note: new Set(activeBoard.noteIds),
            group: new Set(activeBoard.groupIds),
            frame: new Set(activeBoard.frameIds),
          }
        : null,
    [activeBoard],
  );
  const scopeIds = activeBoard ? activeBoard.assetIds : null;

  return {
    boards,
    activeBoardId,
    activeBoard,
    scopeIds,
    createBoard,
    renameBoard,
    deleteBoard,
    recolorBoard,
    selectBoard,
    addToBoard,
    onCanvasObject,
    ownedIds,
  };
}
