"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetLabel, Board, CanvasAnnotation, CanvasEdge, CanvasGroup, LabelNames } from "@archivemind/shared";
import type { Photo } from "@/types";
import { useWorkspace, type BoardDrop, type ProjectOption } from "@/hooks/useWorkspace";
import { useBoards } from "@/hooks/useBoards";
import { LABEL_COLORS } from "@/lib/labels";
import BoardBrowser from "@/components/header/BoardBrowser";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import FolderOverlay from "@/components/canvas/FolderOverlay";
import StickyNoteOverlay from "@/components/canvas/StickyNoteOverlay";
import ProjectAssetView from "@/components/canvas/ProjectAssetView";
import CloudDecor, { CloudLabels } from "@/components/canvas/CloudDecor";
import GeoMapPane from "@/components/map/GeoMapPane";
import AppHeader from "@/components/header/AppHeader";
import ViewSwitcher from "@/components/toolbar/ViewSwitcher";
import ProjectDropdown from "@/components/header/ProjectDropdown";
import ZoomDropdown from "@/components/header/ZoomDropdown";
import AccountDropdown from "@/components/header/AccountDropdown";
import ChatPanel from "@/components/chat/ChatPanel";
import LeftToolbar from "@/components/toolbar/LeftToolbar";
import SortingActionBar from "@/components/toolbar/SortingActionBar";
import WorkspaceActionBar from "@/components/toolbar/WorkspaceActionBar";
import Minimap from "@/components/toolbar/Minimap";
import TrashPanel from "@/components/trash/TrashPanel";
import AddToProjectPopover from "@/components/toolbar/AddToProjectPopover";
import CanvasContextMenu from "@/components/canvas/CanvasContextMenu";
import SourceBrowserSidebar from "@/components/sidebar/SourceBrowserSidebar";
import BulkAiPanel from "@/components/bulk-ai/BulkAiPanel";
import PhotoDrawer from "@/components/drawer/PhotoDrawer";
import ImageEditor from "@/components/editor/ImageEditor";
import ExportDialog from "@/components/export/ExportDialog";
import ImportModal from "@/components/import/ImportModal";
import UploadManager from "@/components/upload/UploadManager";
import Toast from "@/components/modals/Toast";
// SearchModal retired — the magnifier now opens the real Smart Search panel (ChatPanel).
import ConfirmModal from "@/components/modals/ConfirmModal";
import WorkspaceOutputActions from "@/components/content/WorkspaceOutputActions";
import CreateOutputDialog from "@/components/content/CreateOutputDialog";
import CreateHubDialog from "@/components/content/CreateHubDialog";
import EdgeDropMenu from "@/components/canvas/EdgeDropMenu";
import EdgeLayer from "@/components/canvas/EdgeLayer";
import { deriveThreads } from "@/lib/threads";
import ContentDraftStudio from "@/components/content/ContentDraftStudio";
import SharePreviewDialog, {
  type SharePreviewOptions,
  type SharePreviewResult,
} from "@/components/content/SharePreviewDialog";
import {
  contentGenerationResultSchema,
  draftFromGeneration,
  generationRequestBody,
  regenerationSeed,
  type CreateOutputInput,
} from "@/lib/content-generation-client";
import {
  deleteContentDraft,
  listContentDrafts,
  loadContentDraft,
  saveContentDraft,
  type ContentDraft,
} from "@/lib/content-drafts";
import { downloadContentDraft } from "@/lib/content-package";
import {
  deleteContentDraftOnServer,
  pushContentDraft,
  syncContentDrafts,
} from "@/lib/content-drafts-sync";
import {
  createPublicationShareResponseSchema,
  deletePublicationShareLink,
  listPublicationSharesResponseSchema,
  loadPublicationShareLink,
  publicationShareRequiresRevoke,
  savePublicationShareLink,
  type PublicationShareSummary,
} from "@/lib/publication-shares";

interface Account {
  initials: string;
  name: string;
  email: string;
}

interface ArchiveWorkspaceProps {
  initialPhotos: Photo[];
  /** Exact active-asset count for this scope. `initialPhotos` is intentionally
   *  bounded until the canvas is virtualized (Phase 5 / #18). */
  initialPhotoTotal: number;
  workspaceId: string;
  projects: ProjectOption[];
  currentProjectId: string;
  initialGroups: CanvasGroup[];
  /** The workspace's colour-label names (defaults with renames applied). */
  initialLabelNames: LabelNames;
  /** Sticky notes (and later ink) for this scope — ADR 0041. Server-read so the
   *  first paint already has them, like initialGroups. */
  initialAnnotations: CanvasAnnotation[];
  /** The project's Workspaces (ADR 0044) — server-read for the same reason as
   *  the groups and annotations above: a chip row that pops in after mount
   *  reads as a glitch. */
  initialBoards: Board[];
  /** User-drawn connections, every board's (ADR 0048) — server-read likewise. */
  initialEdges: CanvasEdge[];
  account: Account;
}

export default function ArchiveWorkspace({
  initialPhotos,
  initialPhotoTotal,
  workspaceId,
  projects,
  currentProjectId,
  initialGroups,
  initialLabelNames,
  initialAnnotations,
  initialBoards,
  initialEdges,
  account,
}: ArchiveWorkspaceProps) {
  // Workspaces (boards) — a named, colour-coded set of the project's files
  // (ADR 0044). Additive on purpose: opening one narrows the canvas to its
  // files and nothing else changes, so notes, folders, the sorting
  // views and export all keep working exactly as they do with none open.
  // `useBoards` reports failures through the canvas toast, but the toast lives
  // on `ws`, which needs the board scope to exist first. A ref breaks the knot
  // without either hook importing the other: board writes are async, so the ref
  // is always filled by the time one can fail.
  const toastRef = useRef<(text: string) => void>(() => {});
  const boardToast = useCallback((text: string) => toastRef.current(text), []);
  const bd = useBoards(currentProjectId, initialBoards, boardToast);

  // Same knot as the toast: the handler below needs `ws`, which needs the drop
  // callback. A stable forwarder goes in; the real implementation is attached
  // once `ws` exists. Drops are pointer-driven, so it is always attached by the
  // time one can happen.
  const dropOnBoardRef = useRef<(boardId: string, drop: BoardDrop) => void>(() => {});
  const dropOnBoard = useCallback(
    (boardId: string, drop: BoardDrop) => dropOnBoardRef.current(boardId, drop),
    [],
  );


  const ws = useWorkspace(
    initialPhotos,
    workspaceId,
    projects,
    currentProjectId,
    initialGroups,
    initialLabelNames,
    initialAnnotations,
    initialEdges,
    bd.scopeIds,
    bd.activeBoardId,
    dropOnBoard,
  );

  // A Workspace owns the notes and folders MADE in it, and hides the
  // rest — the same rule the photos follow (ADR 0044). With no Workspace open
  // everything shows, again like photos: the un-scoped canvas is the project.
  //
  // Filtered here, at the render seam, and NOT in `canvasPhotos`: these objects
  // carry their own geometry and have no layout to re-pack, so there is nothing
  // for a scope to change about where they sit. Hiding is the whole effect.
  /** A photo, note or folder was dropped onto a Workspace chip (ADR 0044).
   *  "Add" means different things per kind and that is the point of resolving it
   *  here: a photo JOINS the workspace (many-to-many — it stays in the project
   *  and in any other workspace), while a note or a folder CHANGES OWNER, since
   *  each is made in one place. Neither removes anything from All files. */
  const handleDropOnBoard = useCallback(
    (boardId: string, drop: BoardDrop) => {
      const name = bd.boards.find((b) => b.id === boardId)?.name ?? "the workspace";
      if (drop.kind === "photos") {
        bd.addToBoard(boardId, drop.ids);
        toastRef.current(
          drop.ids.length > 1 ? `Added ${drop.ids.length} files to ${name}` : `Added to ${name}`,
        );
        return;
      }
      const url = drop.kind === "note" ? `/api/annotations/${drop.id}` : `/api/canvas-groups/${drop.id}`;
      void fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          ws.setObjectBoard(drop.kind, drop.id, boardId);
          toastRef.current(`Moved to ${name}`);
        })
        .catch(() => toastRef.current("Couldn't move it to the workspace"));
    },
    [bd, ws],
  );

  useEffect(() => {
    toastRef.current = ws.flashToast;
  }, [ws.flashToast]);
  useEffect(() => {
    dropOnBoardRef.current = handleDropOnBoard;
  }, [handleDropOnBoard]);

  // A folder runs its own drag (FolderOverlay), so its armed chip is tracked
  // here rather than inside the canvas drag session.
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null);

  // Deleting a Workspace asks first (ADR 0044 as amended). The × sits on the
  // chip you click to OPEN one, so an unconfirmed click there was the cheapest
  // way in the whole header to lose an arrangement. Two questions share the
  // modal because they are the same question at different stakes: `trash` is
  // reversible and says so, `purge` is not.
  const [boardConfirm, setBoardConfirm] = useState<{ id: string; mode: "trash" | "purge" } | null>(null);
  const confirmBoard = boardConfirm
    ? ([...bd.boards, ...bd.trashedBoards].find((b) => b.id === boardConfirm.id) ?? null)
    : null;

  /** Restore from the Trash panel — the toast right after a delete carries its
   *  own Undo (below), so this is the later, deliberate path. */
  const restoreBoard = useCallback(
    (id: string) => {
      const name = bd.trashedBoards.find((b) => b.id === id)?.name;
      bd.restoreBoard(id);
      ws.flashToast(name ? `${name} restored` : "Workspace restored");
    },
    [bd, ws],
  );

  // Exactly one bottom bar, always. The working bar belongs to a Workspace's
  // Canvas; everything else — the project canvas, the sorting views, all-files,
  // and a Workspace's own sorting views — gets the narrow one. Derived once so
  // the two gates cannot drift into showing both or neither.
  const workingBar = bd.activeBoardId !== null && ws.view === "neural";

  // Workspace → Draft → Delivery is a separate state machine from the canvas.
  // Drafts snapshot their source ids, so membership changes only raise a
  // warning; they never rewrite a publication the user may have edited.
  // The chain is hub → brief → studio, and Escape walks it backwards.
  const [outputUi, setOutputUi] = useState<"closed" | "hub" | "brief" | "studio">("closed");
  const [briefKind, setBriefKind] = useState<CreateOutputInput["kind"]>("article");
  const [draftsByBoard, setDraftsByBoard] = useState<Record<string, ContentDraft[]>>({});
  const [activeDraft, setActiveDraft] = useState<ContentDraft | null>(null);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [createSeed, setCreateSeed] = useState<Partial<CreateOutputInput> | null>(null);
  const [draftSaveState, setDraftSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [draftConfirm, setDraftConfirm] = useState<"delete" | "regenerate" | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<SharePreviewResult | null>(null);
  const [sharedDraftId, setSharedDraftId] = useState<string | null>(null);
  const [sharedDraftVersion, setSharedDraftVersion] = useState<number | null>(null);
  /** Server truth about which versions of the open draft are live. `null` until
   *  it has been read once — absence only means "ended" after a real answer. */
  const [shareLinks, setShareLinks] = useState<readonly PublicationShareSummary[] | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Re-read this Workspace's drafts from the browser, and mirror the one that
   *  just changed to the server (ADR 0045 amendment). The local write already
   *  succeeded by the time this runs, so the upload is deliberately not awaited
   *  and its failure is not surfaced: the draft is safe either way, and the
   *  next sync carries it up. Passing the saved draft rather than pushing the
   *  whole list keeps the mirror to one request per save. */
  const refreshDrafts = useCallback((boardId: string | null, mirror?: ContentDraft) => {
    if (!boardId) return;
    setDraftsByBoard((current) => ({ ...current, [boardId]: listContentDrafts(boardId) }));
    if (mirror) void pushContentDraft(boardId, mirror);
  }, []);

  /** Opening a Workspace reconciles its drafts with the durable copies. This is
   *  also the adoption path for anything written before the table existed, and
   *  the reason a cleared browser no longer loses the text somebody wrote. */
  useEffect(() => {
    const boardId = bd.activeBoardId;
    if (!boardId) return;
    let cancelled = false;
    void syncContentDrafts(boardId).then((drafts) => {
      if (!cancelled && drafts) setDraftsByBoard((current) => ({ ...current, [boardId]: drafts }));
    });
    return () => {
      cancelled = true;
    };
  }, [bd.activeBoardId]);

  /** Opening a Workspace puts you on its canvas. Draft UI is scoped to that
   * Workspace too, so a switch closes it and loads the target's local index. */
  const openBoard = useCallback(
    (id: string | null) => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      if (activeDraft && draftSaveState !== "saved") {
        const saved = saveContentDraft(activeDraft.boardId, activeDraft, { mode: "manual" });
        if (saved.ok) refreshDrafts(activeDraft.boardId, saved.draft);
      }
      setActiveDraft(null);
      setOutputUi("closed");
      setGenerationError(null);
      setCreateSeed(null);
      setShareOpen(false);
      setShareBusy(false);
      setShareError(null);
      setShareResult(null);
      setSharedDraftId(null);
      setSharedDraftVersion(null);
      setShareLinks(null);
      if (id) refreshDrafts(id);
      bd.selectBoard(id);
      if (id !== null) ws.setView("neural");
    },
    [activeDraft, bd, draftSaveState, refreshDrafts, ws],
  );

  const drafts = useMemo(
    () => bd.activeBoardId
      ? (draftsByBoard[bd.activeBoardId] ?? listContentDrafts(bd.activeBoardId))
      : [],
    [bd.activeBoardId, draftsByBoard],
  );

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const orderedBoardAssetIds = useMemo(() => {
    const ids = bd.activeBoard?.assetIds ?? [];
    const position = ws.projectAssetPositions;
    const incomingIndex = new Map(ids.map((id, index) => [id, index]));
    // Capture the visible canvas's reading order once. Unloaded/off-window ids
    // keep their durable board position and follow the placed rows.
    return [...ids].sort((left, right) => {
      const a = position[left];
      const b = position[right];
      if (!a && !b) return (incomingIndex.get(left) ?? 0) - (incomingIndex.get(right) ?? 0);
      if (!a) return 1;
      if (!b) return -1;
      const rowA = Math.floor(a.cy / 140);
      const rowB = Math.floor(b.cy / 140);
      return rowA - rowB || a.cx - b.cx || (incomingIndex.get(left) ?? 0) - (incomingIndex.get(right) ?? 0);
    });
  }, [bd.activeBoard?.assetIds, ws.projectAssetPositions]);

  const orderedSelectedIds = useMemo(() => {
    const selected = [...ws.selectedIds];
    const selectedSet = new Set(selected);
    return orderedBoardAssetIds.filter((id) => selectedSet.has(id));
  }, [orderedBoardAssetIds, ws.selectedIds]);

  const openDraft = useCallback((draft: ContentDraft) => {
    const current = loadContentDraft(draft.boardId, draft.id) ?? draft;
    const remembered = loadPublicationShareLink(current.id);
    setActiveDraft(current);
    setShareResult(remembered?.result ?? null);
    setSharedDraftId(remembered?.draftId ?? current.id);
    setSharedDraftVersion(remembered?.draftVersion ?? null);
    setShareLinks(null);
    setShareError(null);
    setOutputUi("studio");
    setDraftSaveState("saved");
  }, []);

  const closeStudio = useCallback(() => {
    if (draftSaveState === "error") {
      ws.flashToast("Draft is not saved. Keep the editor open and try again.");
      return;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (activeDraft && draftSaveState !== "saved") {
      const saved = saveContentDraft(activeDraft.boardId, activeDraft, { mode: "manual" });
      if (!saved.ok) {
        setDraftSaveState("error");
        ws.flashToast("Draft could not be saved. The editor stays open.");
        return;
      }
      refreshDrafts(activeDraft.boardId, saved.draft);
    }
    setActiveDraft(null);
    setOutputUi("hub");
  }, [activeDraft, draftSaveState, refreshDrafts, ws]);

  const deleteActiveDraft = useCallback(() => {
    if (!activeDraft) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!deleteContentDraft(activeDraft.boardId, activeDraft.id)) {
      setDraftConfirm(null);
      ws.flashToast("The draft could not be deleted. Try again.");
      return;
    }
    void deleteContentDraftOnServer(activeDraft.boardId, activeDraft.id);
    refreshDrafts(activeDraft.boardId);
    setDraftConfirm(null);
    setActiveDraft(null);
    setDraftSaveState("saved");
    setOutputUi("hub");
  }, [activeDraft, refreshDrafts, ws]);

  const editDraft = useCallback((next: ContentDraft) => {
    setActiveDraft(next);
    setDraftSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const saved = saveContentDraft(next.boardId, next, { mode: "manual" });
      if (!saved.ok) {
        setDraftSaveState("error");
        return;
      }
      setActiveDraft(saved.draft);
      setDraftSaveState("saved");
      refreshDrafts(next.boardId, saved.draft);
    }, 450);
  }, [refreshDrafts]);

  /** The link's address is unrecoverable, but its status is not: the server
   *  says which versions are still live, so a lost or cleared browser can no
   *  longer strand a public link nobody can switch off. The question is asked
   *  per BOARD — a draft lives in localStorage, so scoping the query by draft id
   *  would hide exactly the links whose draft this browser has already lost. */
  const refreshShareLinks = useCallback(async (draft: ContentDraft) => {
    try {
      const response = await fetch(
        `/api/content-shares?boardId=${encodeURIComponent(draft.boardId)}`,
      );
      if (!response.ok) return;
      const parsed = listPublicationSharesResponseSchema.safeParse(await response.json());
      if (parsed.success) setShareLinks(parsed.data.shares);
    } catch {
      // Best-effort: an unreachable list leaves the dialog on what it knows.
    }
  }, []);

  const openSharePreview = useCallback(() => {
    if (!activeDraft) return;
    if (draftSaveState === "error") {
      ws.flashToast("Save the draft before creating a preview link.");
      return;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (draftSaveState !== "saved") {
      const saved = saveContentDraft(activeDraft.boardId, activeDraft, { mode: "manual" });
      if (!saved.ok) {
        setDraftSaveState("error");
        ws.flashToast("Draft could not be saved. Preview link was not created.");
        return;
      }
      setActiveDraft(saved.draft);
      setDraftSaveState("saved");
      refreshDrafts(activeDraft.boardId, saved.draft);
    }
    const remembered = loadPublicationShareLink(activeDraft.id);
    if (sharedDraftId !== activeDraft.id || !shareResult) {
      setShareResult(remembered?.result ?? null);
      setSharedDraftId(activeDraft.id);
      setSharedDraftVersion(remembered?.draftVersion ?? null);
    }
    setShareError(null);
    setShareOpen(true);
    void refreshShareLinks(activeDraft);
  }, [activeDraft, draftSaveState, refreshDrafts, refreshShareLinks, shareResult, sharedDraftId, ws]);

  const createSharePreview = useCallback(async (options: SharePreviewOptions) => {
    if (!activeDraft || shareBusy) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const response = await fetch("/api/content-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: activeDraft, options }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = typeof payload === "object" && payload !== null && "error" in payload
          ? String(payload.error)
          : "share_unavailable";
        throw new Error(code);
      }
      const created = createPublicationShareResponseSchema.parse(payload);
      setSharedDraftId(activeDraft.id);
      setSharedDraftVersion(activeDraft.version);
      const result = {
        shareId: created.shareId,
        url: new URL(created.path, window.location.origin).toString(),
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
      };
      setShareResult(result);
      savePublicationShareLink({
        schemaVersion: 1,
        draftId: activeDraft.id,
        draftVersion: activeDraft.version,
        result,
      });
      void refreshShareLinks(activeDraft);
    } catch (error) {
      const code = error instanceof Error ? error.message : "share_unavailable";
      setShareError(
        code === "media_not_ready"
          ? "One or more images are still being prepared. Try again in a moment."
          : code === "too_many_assets"
            ? "A public preview can contain up to 20 placed images."
            : code === "editor_required"
              ? "You need editor access to create a public link."
              : "The preview link could not be created. Try again.",
      );
    } finally {
      setShareBusy(false);
    }
  }, [activeDraft, refreshShareLinks, shareBusy]);

  const revokeSharePreview = useCallback(async (shareId: string) => {
    if (shareBusy) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const response = await fetch(`/api/content-shares/${encodeURIComponent(shareId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("revoke_failed");
      // Turning off a link this browser holds closes the dialog; turning off one
      // it only knows about from the server leaves it open, since that list is
      // the reason the author came here.
      const wasLocal = shareResult?.shareId === shareId;
      if (wasLocal) {
        if (activeDraft) deletePublicationShareLink(activeDraft.id);
        setShareResult(null);
        setShareOpen(false);
      }
      setShareLinks((links) => links?.filter((link) => link.shareId !== shareId) ?? null);
      if (activeDraft) void refreshShareLinks(activeDraft);
      ws.flashToast("Preview link turned off");
    } catch {
      setShareError("The link could not be turned off. Try again.");
    } finally {
      setShareBusy(false);
    }
  }, [activeDraft, refreshShareLinks, shareBusy, shareResult, ws]);

  /** The board-wide answer, narrowed to the draft on screen and to versions a
   *  person can still act on. `publicationShareRequiresRevoke` drops expired
   *  ones: they are already closed, so offering "Turn off" would be theatre. */
  const draftShareLinks = useMemo(() => {
    if (!shareLinks || !activeDraft) return null;
    return shareLinks.filter(
      (link) => link.sourceDraftId === activeDraft.id && publicationShareRequiresRevoke(link),
    );
  }, [activeDraft, shareLinks]);

  const dismissShareResult = useCallback(() => {
    if (activeDraft) deletePublicationShareLink(activeDraft.id);
    setShareResult(null);
    setSharedDraftVersion(null);
    setShareError(null);
  }, [activeDraft]);

  const generateOutput = useCallback(async (input: CreateOutputInput) => {
    const board = bd.activeBoard;
    if (!board) return;
    setGenerationBusy(true);
    setGenerationError(null);
    try {
      const response = await fetch("/api/content-drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(generationRequestBody(board.id, input)),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = typeof payload === "object" && payload !== null && "error" in payload ? String(payload.error) : "generation_failed";
        throw new Error(code);
      }
      const result = contentGenerationResultSchema.parse(payload);
      const candidate = draftFromGeneration(board.id, board.name, input, result);
      const saved = saveContentDraft(board.id, candidate, { mode: "generated" });
      if (!saved.ok) throw new Error(saved.reason);
      refreshDrafts(board.id, saved.draft);
      setActiveDraft(saved.draft);
      setOutputUi("studio");
      setDraftSaveState("saved");
      setCreateSeed(null);
    } catch (error) {
      const code = error instanceof Error ? error.message : "generation_failed";
      const message = code === "editor_required"
        ? "Editor access is required to generate content."
        : code === "source_assets_not_found"
          ? "Some source photos are no longer in this Workspace."
          : code === "generation_failed"
            ? "The draft could not be generated. Try again."
            : "The draft could not be created. Try again.";
      setGenerationError(message);
    } finally {
      setGenerationBusy(false);
    }
  }, [bd.activeBoard, refreshDrafts]);

  // Ownership is a `board_id` on the object now (ADR 0044), not a list on the
  // board, so this is a plain equality — and it means a workspace's notes are
  // the same on every device, which the localStorage lists could never be.
  const board = bd.activeBoardId;
  const scopedNotes = board ? ws.stickyNotes.filter((n) => n.boardId === board) : ws.stickyNotes;
  const scopedFolders = board ? ws.folders.filter((f) => f.boardId === board) : ws.folders;
  // Edges are stricter than notes: they exist ONLY inside their board
  // (board_id NOT NULL, ADR 0048), so with none open there are none to show.
  const scopedEdges = useMemo(
    () => (board ? ws.edges.filter((edge) => edge.boardId === board) : []),
    [board, ws.edges],
  );

  // Authored chains → CREATE source options (ADR 0048). Derived beside the
  // reading order because a thread's tiebreaks come from it.
  const boardAssetIdSet = useMemo(() => new Set(bd.activeBoard?.assetIds ?? []), [bd.activeBoard]);
  const threads = useMemo(
    () => deriveThreads(scopedEdges, boardAssetIdSet, orderedBoardAssetIds),
    [scopedEdges, boardAssetIdSet, orderedBoardAssetIds],
  );

  // Counts come from the loaded photo set, not the board's raw id list: an id
  // whose asset has since been trashed must not still be counted on a chip.
  const boardCounts: Record<string, number> = {};
  for (const b of bd.boards) {
    const ids = new Set(b.assetIds);
    boardCounts[b.id] = ws.photos.filter((p) => ids.has(p.id)).length;
  }

  // The colour the label pickers should ring: what the whole target carries, or
  // "mixed" when it disagrees. Target = the selection, else the right-clicked
  // tile — the same selection-first rule the pickers themselves apply.
  const labelTargetIds = ws.selectedIds.size > 0
    ? [...ws.selectedIds]
    : ws.contextMenu?.targetId
      ? [ws.contextMenu.targetId]
      : [];
  const targetLabels = new Set(
    labelTargetIds.map((id) => ws.photos.find((p) => p.id === id)?.label ?? null),
  );
  const currentLabel: AssetLabel | "mixed" | null =
    targetLabels.size === 1 ? ([...targetLabels][0] ?? null) : targetLabels.size > 1 ? "mixed" : null;

  const hiddenPhotoCount = Math.max(0, initialPhotoTotal - initialPhotos.length);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        // dvh, not vh: on iOS `100vh` is the LARGE viewport, so the bottom
        // action bars (bottom: 20) sat underneath Safari's own toolbar and were
        // unreachable until the chrome happened to collapse.
        height: "100dvh",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Ruled lines mean "you are inside a Workspace"; dots mean the whole
          project. The background carries the SCOPE, not the activity: whether a
          view is for building or for browsing is already shouted by the working
          action bar and the notes and folders on screen, whereas a narrowed
          canvas looks exactly like a full one and is otherwise announced only by
          a chip in the header — which is how "where did my photos go" happens. */}
      <InfiniteGrid
        gridSize={ws.gridSize}
        gridPos={ws.gridPos}
        gridOpacity={ws.gridOpacity}
        variant={bd.activeBoardId !== null ? "lines" : "dots"}
      />

      <PanZoomCanvas
        setCanvasRef={ws.setCanvasRef}
        onCanvasDown={ws.onCanvasDown}
        onCanvasContext={(e) => {
          e.preventDefault();
          ws.openContextMenu(e.clientX, e.clientY, null);
        }}
        canvasCursor={ws.canvasCursor}
        canvasTransform={ws.canvasTransform}
        animating={ws.tilesAnimating}
        marquee={ws.marquee}
      >
        {/* Folders and sticky notes are a Workspace (neural) concept
            only — their geometry is in neural coordinates, so they'd render
            misplaced on Timeline/Topic/Labels (and Map covers the canvas
            entirely). A note pinned over one arrangement means nothing over
            another: every sorting view lays the same tiles out differently, in
            its own override bucket, so there is no position the note could be
            carried to that would still say what it said. */}
        {ws.view === "neural" && (
          <>
            <FolderOverlay
              folders={scopedFolders}
              scale={ws.scale}
              openFolderId={ws.openFolderId}
              onOpen={ws.openFolder}
              onClose={ws.closeFolder}
              onOpenPhoto={(id) => {
                ws.closeFolder();
                ws.openDrawer(id);
              }}
              onDropMemberOut={ws.dropMemberOnCanvas}
              onMove={ws.moveGroup}
              onDropOnBoard={(boardId, folderId) =>
                dropOnBoardRef.current(boardId, { kind: "folder", id: folderId })
              }
              onBoardHover={setFolderDropTarget}
              onRename={ws.renameGroup}
              onDelete={ws.deleteGroup}
            />
            {/* User-drawn connections (ADR 0048) — board-only, like the ports
                that create them: an edge is a statement inside one Workspace.
                Rendered BEFORE the overlays' cards in DOM but z-pinned to the
                CloudDecor band (1), under every tile and note. */}
            {bd.activeBoardId !== null && (
              <EdgeLayer
                edges={scopedEdges}
                positions={ws.activePositions}
                notes={scopedNotes}
                selectedEdgeId={ws.selectedEdgeId}
                onSelect={ws.selectEdge}
                setLiveRef={ws.setEdgeLiveRef}
              />
            )}
            <StickyNoteOverlay
              notes={scopedNotes}
              labelNames={ws.labelNames}
              onDragStart={ws.onStickyDown}
              onResizeStart={ws.onStickyResizeDown}
              onTextChange={ws.updateStickyText}
              onColorChange={ws.setStickyColor}
              onFontSizeChange={ws.setStickyFontSize}
              onToggleCheck={ws.toggleStickyCheck}
              onSetStrokes={ws.setStickyStrokes}
              onDelete={ws.deleteStickyNote}
              onEdgeStart={
                bd.activeBoardId !== null
                  ? (e, id, center) => ws.onEdgeStart(e, { kind: "annotation", id }, center)
                  : undefined
              }
              edgeDropTargetId={ws.edgeDropTarget?.kind === "annotation" ? ws.edgeDropTarget.id : null}
            />
          </>
        )}
        {/* Grouping views draw their colored backdrop + connecting lines behind
            the tiles; the tiles themselves are the same persistent set in every
            view, so switching a sort just reflows (animates) their positions. */}
        {ws.cloudDecor && (
          <CloudDecor
            layout={ws.cloudDecor}
            edgesReady={!ws.tilesAnimating}
            focusedCloudKey={ws.focusedCloudKey}
            dropTargetKey={ws.isSenseView ? ws.topicDropTargetKey : null}
          />
        )}
        <ProjectAssetView
          // visiblePhotos, not projectPhotos: the label filter narrows what is
          // DRAWN while every layout above still runs over the full set, so a
          // filter can never move a tile that survives it.
          photos={ws.visiblePhotos}
          previews={ws.visiblePreviews}
          positions={ws.activePositions}
          previewPositions={ws.projectAssetPositions}
          selectedIds={ws.selectedIds}
          hoveredId={ws.hoveredId}
          animating={ws.tilesAnimating}
          zOrder={ws.tileZ}
          focusedCloudKey={ws.focusedCloudKey}
          tileCloud={ws.tileCloud}
          aiBusyIds={ws.aiBusyIds}
          onTileDown={ws.onTileDown}
          setHover={ws.setHover}
          openDrawer={ws.openDrawer}
          deletePhoto={ws.deletePhoto}
          openContextMenu={ws.openContextMenu}
          analyzePhoto={ws.analyzePhoto}
          labelNames={ws.labelNames}
          // Wire ports exist only where edges do: the neural view of an open
          // Workspace (ADR 0048).
          onEdgeStart={
            ws.view === "neural" && bd.activeBoardId !== null
              ? (e, id, center) => ws.onEdgeStart(e, { kind: "asset", id }, center)
              : undefined
          }
          edgeDropTargetId={ws.edgeDropTarget?.kind === "asset" ? ws.edgeDropTarget.id : null}
        />
        {ws.cloudDecor && (
          <CloudLabels
            layout={ws.cloudDecor}
            focusedCloudKey={ws.focusedCloudKey}
            onCloudLabelDown={ws.onCloudLabelDown}
            // Topic is the only view whose cloud names mean anything a user can
            // set — a rename there pins a cluster's label (ADR 0038). Timeline's
            // labels are dates and rename nothing.
            onRenameCloud={
              ws.isSenseView
                ? (cloud, name) => cloud.clusterId && ws.renameCloud(cloud.clusterId, name)
                : undefined
            }
            canRenameCloud={
              ws.isSenseView
                ? // Only a cloud backed by exactly ONE stored cluster: two
                  // clusters sharing a label draw as one cloud, and renaming
                  // "it" would silently rename half of it.
                  (cloud) => !!cloud.clusterId
                : undefined
            }
            dropTargetKey={ws.isSenseView ? ws.topicDropTargetKey : null}
            dropCount={ws.selectedIds.size}
          />
        )}
      </PanZoomCanvas>

      {/* MAP is the one view that is not a sort of the canvas tiles — it is a
          real geographic map over its own basemap (ADR 0027), so it covers the
          canvas rather than reflowing it. */}
      {ws.isMapView && (
        <GeoMapPane
          photos={ws.visiblePhotos}
          selectedIds={ws.selectedIds}
          onOpenAsset={ws.openDrawer}
          onSelectAssets={ws.selectSearchResults}
        />
      )}

      {/* Filtered down to nothing. Distinct from the empty state below on
          purpose: a canvas hiding every file must say WHY and offer the way
          back, or it is indistinguishable from an archive that lost its
          contents. */}
      {ws.labelFilter && ws.visiblePhotos.length === 0 && ws.projectPhotos.length > 0 && (
        <div
          style={{
            position: "absolute",
            inset: "var(--hdr) 0 0 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t2)" }}>
            {ws.labelFilter === "none"
              ? "Everything here is labelled"
              : `Nothing marked ${ws.labelNames[ws.labelFilter]}`}
          </div>
          <button
            onClick={ws.clearLabelFilter}
            style={{
              pointerEvents: "auto",
              marginTop: 2,
              height: 30,
              padding: "0 14px",
              background: "transparent",
              color: "var(--t1)",
              border: "1px solid var(--bdh)",
              borderRadius: 2,
              fontSize: 12,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* An open workspace with nothing in it. Its own state, and gated BEFORE
          the project-empty one below: a scoped canvas with no files is not an
          empty project, and telling someone to import photos into a project that
          already has hundreds is worse than saying nothing. */}
      {bd.activeBoardId !== null && ws.projectPhotos.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: "var(--hdr) 0 0 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t2)" }}>
            This workspace is empty
          </div>
          <div style={{ fontSize: 11.5, color: "var(--t2)" }}>
            Open All files, select what belongs here, then Add to workspace.
          </div>
          <button
            onClick={() => bd.selectBoard(null)}
            style={{
              pointerEvents: "auto",
              marginTop: 2,
              height: 30,
              padding: "0 14px",
              background: "transparent",
              color: "var(--t1)",
              border: "1px solid var(--bdh)",
              borderRadius: 2,
              fontSize: 12,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Show all files
          </button>
        </div>
      )}

      {/* Empty state — a project emptied after creation used to render a bare
          grid with no affordance (the import modal auto-opens only for fresh
          projects). Sits under the header/toolbar chrome. */}
      {bd.activeBoardId === null && ws.projectPhotos.length === 0 && ws.uploadPreviews.length === 0 && !ws.impOpen && (
        <div
          style={{
            position: "absolute",
            inset: "var(--hdr) 0 0 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t2)" }}>
            {ws.projCurrent === "all" ? "Your archive is empty" : "This project is empty"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--t2)" }}>
            {ws.allFilesMode ? "Open a project to upload files" : "Drop files anywhere — or import from a source"}
          </div>
          <button
            onClick={ws.allFilesMode ? ws.goHome : ws.addToolbar}
            style={{
              pointerEvents: "auto",
              marginTop: 6,
              height: 32,
              padding: "0 14px",
              background: "var(--ac)",
              color: "#050505",
              border: 0,
              borderRadius: 2,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {ws.allFilesMode ? "View projects" : "+ Import files"}
          </button>
        </div>
      )}

      <AppHeader
        projLabel={ws.projLabel}
        onHome={ws.goHome}
        onOpenProj={ws.openProj}
        // The project name is the way back to the whole project — it replaced
        // the Workspace browser's "All files" chip, which said the same thing
        // one control to the right. Only in a project: the workspace-wide `all`
        // canvas has no Workspace to leave.
        onProjectScope={ws.projectMode ? () => openBoard(null) : undefined}
        projectScopeActive={bd.activeBoardId === null}
        showZoomControl={!ws.isMapView}
        zoomPct={ws.zoomPct}
        onToggleZoomMenu={ws.toggleZoomMenu}
        canUndo={ws.canUndo}
        canRedo={ws.canRedo}
        onUndo={ws.undo}
        onRedo={ws.redo}
        onFlashToast={ws.flashToast}
        onOpenAcct={ws.openAcct}
        accountInitials={account.initials}
        accountName={account.name}
        afterProject={
          ws.projectMode ? (
            <BoardBrowser
              boards={bd.boards}
              activeBoardId={bd.activeBoardId}
              counts={boardCounts}
              labelNames={ws.labelNames}
              onRecolor={bd.recolorBoard}
              dropTargetId={ws.boardDropTargetId ?? folderDropTarget}
              onSelect={openBoard}
              onCreate={() => {
                bd.createBoard();
                ws.setView("neural");
              }}
              onRename={bd.renameBoard}
              onDelete={(id) => setBoardConfirm({ id, mode: "trash" })}
            />
          ) : undefined
        }
      />

      {/* Persistent by design: this is archive-integrity information, not a
          transient toast. Until #18 virtualizes the canvas, the newest 500 are
          the working set and this makes the remainder impossible to mistake
          for a failed upload. */}
      {hiddenPhotoCount > 0 && (
        <div
          role="status"
          // Same reason as the toast: below 760px the workspace rail occupies
          // this band, and this notice sits under it in the z ladder.
          className="am-under-hdr"
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 34,
            maxWidth: "calc(100vw - 32px)",
            padding: "6px 10px",
            background: "rgba(8,8,8,.88)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            boxShadow: "0 8px 24px rgba(0,0,0,.32)",
            color: "var(--t2)",
            fontSize: 10.5,
            lineHeight: 1.35,
            letterSpacing: "0.02em",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          Showing newest {initialPhotos.length} of {initialPhotoTotal} files on this canvas. The other{" "}
          {hiddenPhotoCount} remain in your archive.
        </div>
      )}

      <ZoomDropdown
        open={ws.zoomMenuOpen}
        zoomPct={ws.zoomPct}
        onClose={ws.closeZoomMenu}
        onSelectPct={ws.setZoomPct}
        onFit={ws.onFit}
      />

      <ProjectDropdown
        open={ws.projOpen}
        list={ws.projectList}
        onClose={ws.closeProj}
        onSelect={ws.selectProject}
      />

      <AccountDropdown open={ws.acctOpen} account={account} onClose={ws.closeAcct} onFlashToast={ws.flashToast} />

      <ChatPanel
        open={ws.chatOpen}
        msgs={ws.chatMsgs}
        input={ws.chatInput}
        onClose={ws.closeChat}
        onInput={ws.onChatInput}
        onKey={ws.onChatKey}
        onSend={ws.sendChat}
        onOpenResult={ws.openDrawer}
        onSelectResults={ws.selectSearchResults}
      />

      <LeftToolbar
        tool={ws.tool}
        allFilesMode={ws.allFilesMode}
        isMapView={ws.isMapView}
        showAddToProject={ws.showAddToProject}
        selCount={ws.selectedIds.size}
        zoomPct={ws.zoomPct}
        searchOpen={ws.chatOpen}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onOpenSearch={ws.toggleChat}
        onAdd={ws.addToolbar}
        onToggleTrash={ws.toggleTrash}
        trashOpen={ws.trashOpen}
        onFit={ws.onFit}
        onZoomReset={ws.onZoomReset}
        onAddToProject={ws.toggleAddProj}
      />

      <TrashPanel
        open={ws.trashOpen}
        assets={ws.trashAssets}
        // Project-scoped, unlike the photos beside them: a workspace belongs to
        // one project, so all-files (which has no workspaces to begin with)
        // shows none.
        boards={bd.trashedBoards}
        onClose={ws.closeTrash}
        onRestore={ws.restoreFromTrash}
        onPurge={ws.purgeFromTrash}
        onRestoreBoard={restoreBoard}
        onPurgeBoard={(id) => setBoardConfirm({ id, mode: "purge" })}
      />

      {/* The working bar belongs to a Workspace. Outside one you are browsing —
          the project canvas and the sorting views get the narrow bar below.
          Folder and Export are mirrored into the right-click menu so nothing
          here is the ONLY way to reach them; Tidy up is not, because it arranges
          a working surface and that is what a Workspace is. */}
      {workingBar && (
        <WorkspaceActionBar
          selCount={ws.selectedIds.size}
          aiOpen={ws.bulkPanelOpen}
          onAddStickyNote={ws.addStickyNote}
          onTidy={ws.tidyUp}
          onAi={ws.toggleBulkPanel}
          onCopy={ws.copyFiles}
          onExport={ws.exportFiles}
          onGroup={ws.groupFiles}
          onFolder={ws.folderFiles}
          onRemoveFromWorkspace={() => {
            if (!bd.activeBoardId || orderedSelectedIds.length === 0) return;
            bd.removeFromBoard(bd.activeBoardId, orderedSelectedIds);
            ws.clearSelection();
            ws.flashToast(orderedSelectedIds.length > 1 ? `Removed ${orderedSelectedIds.length} files from workspace` : "Removed from workspace");
          }}
          onDelete={ws.deleteSelected}
          labelNames={ws.labelNames}
          labelMenuOpen={ws.labelMenuOpen}
          selectionLabel={currentLabel}
          labelFilter={ws.labelFilter}
          onToggleLabelMenu={ws.toggleLabelMenu}
          onPickLabel={(label) => ws.labelSelection(label)}
          onSetFilter={ws.setLabelFilter}
        />
      )}

      {/* Everywhere the Workspace bar is NOT. That bar acts on the `asset`
          bucket and a selection the sorting views don't frame — its "Tidy up"
          would silently rearrange Canvas from inside Topic (ADR 0038) — so the
          two are mutually exclusive rather than one widened gate.
          The all-files grid is in here too, and only for the colour control:
          the untriaged pile is usually exactly what you open all-files to find,
          so that is the one place a filter must not be missing. It gets no
          Regroup (nothing there has an override bucket) and no Re-cluster. */}
      {!workingBar && (
        <SortingActionBar
          showRecluster={ws.isSenseView}
          showRegroup={ws.isSenseView || ws.isTimelineView}
          aboveSwitcher={ws.showViewTabs}
          canRegroup={ws.canRegroup}
          busy={ws.proc.active}
          selCount={ws.selectedIds.size}
          onRegroup={ws.regroupClouds}
          onRecluster={ws.recluster}
          labelNames={ws.labelNames}
          labelMenuOpen={ws.labelMenuOpen}
          selectionLabel={currentLabel}
          labelFilter={ws.labelFilter}
          onToggleLabelMenu={ws.toggleLabelMenu}
          onPickLabel={(label) => ws.labelSelection(label)}
          onSetFilter={ws.setLabelFilter}
          topicMembership={
            ws.isSenseView
              ? {
                  targets: ws.topicOptions,
                  currentTopicId: ws.selectedTopicId,
                  canReturnToAi: ws.canReturnSelectionToAi,
                  busy: ws.topicMutationBusy,
                  onMove: ws.moveSelectionToTopic,
                  onCreate: ws.createTopicFromSelection,
                  onReturnToAi: ws.returnSelectionToAi,
                }
              : undefined
          }
        />
      )}

      {/* The view switcher, bottom-centred. `SortingActionBar` above sits at 66
          so the two stack rather than overlap. */}
      {/* Sorting is an All-files activity: Canvas / Timeline / Topic / Map
          re-arrange the WHOLE project, which is not what a Workspace is for. */}
      <ViewSwitcher show={ws.showViewTabs && bd.activeBoardId === null} view={ws.view} onSelect={ws.setView} />

      {/* Map is its own MapLibre surface (ADR 0027) — the canvas minimap would
          show/pan the hidden neural grid and physically cover MapLibre's own
          zoom control, so it (and the header zoom/Fit) is suppressed on Map. */}
      {!ws.isMapView && <Minimap minimap={ws.minimap} onDown={ws.onMinimapDown} right={ws.minimapRight} />}

      {/* A Workspace's outcome actions, floated at the canvas's top-right rather
          than parked in the header. They only exist inside a Workspace, which is
          exactly the scope whose header rail is most crowded: DRAFTS/DOWNLOAD/
          CREATE cost ~220px, so opening a Workspace used to fold two or three
          chips away the moment you got there. Off the header, the rail measures
          the same room in both scopes.

          It dodges the right-hand panels on `minimapRight` for the same reason
          the minimap does — the photo drawer and the chat are full-height and
          would otherwise cover it — and shares the bottom bars' surface so it
          reads as canvas chrome and stays legible over a photo. z 35 is the
          canvas-internals ceiling (`lib/ui.ts`), matching the minimap and bars.

          `am-under-hdr` is what keeps it clear of the floating workspace rail
          below 760px, where that rail becomes its own 52px row. */}
      {bd.activeBoard && (
        <div
          className="am-under-hdr am-wsactions"
          style={{
            position: "absolute",
            top: "calc(var(--hdr) + 12px)",
            right: 20 + ws.minimapRight,
            zIndex: 35,
            display: "flex",
            alignItems: "center",
            padding: "6px 8px",
            background: "rgba(20,20,20,.92)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            backdropFilter: "blur(16px)",
            boxShadow: "0 8px 32px rgba(0,0,0,.45)",
            transition: "right .2s cubic-bezier(.22,1,.36,1)",
          }}
        >
          <WorkspaceOutputActions
            draftCount={drafts.length}
            photoCount={bd.activeBoard.assetIds.length}
            selectedCount={orderedSelectedIds.length}
            onDownload={() => ws.openExportFor(orderedSelectedIds.length ? orderedSelectedIds : orderedBoardAssetIds)}
            onCreate={() => {
              setGenerationError(null);
              setCreateSeed(null);
              setOutputUi("hub");
            }}
          />
        </div>
      )}

      <AddToProjectPopover
        open={ws.addProjOpen}
        list={ws.projectList}
        onClose={ws.closeAddProj}
        onSelect={ws.addToProject}
        onCreateNew={ws.createNewProject}
        workspaces={bd.boards.map((b) => ({ key: b.id, label: b.name, color: LABEL_COLORS[b.color] }))}
        onSelectWorkspace={(id) => {
          bd.addToBoard(id, [...ws.selectedIds]);
          ws.flashToast("Added to workspace");
          ws.closeAddProj();
        }}
        onCreateWorkspace={() => {
          bd.createBoard(undefined, [...ws.selectedIds]);
          ws.setView("neural");
          ws.closeAddProj();
        }}
      />

      <SourceBrowserSidebar
        open={ws.sidebarOpen}
        tabs={ws.sidebarTabs}
        activeTab={ws.sidebarActiveTab}
        photos={ws.photos}
        selectedIds={ws.sidebarSelectedIds}
        searchText={ws.sidebarSearchText}
        addOpen={ws.sidebarAddOpen}
        projectList={ws.projectList}
        viewMode={ws.sidebarViewMode}
        right={ws.drawerRight}
        onSelectTab={ws.setSidebarActiveTab}
        onCloseTab={ws.closeSourceTab}
        onClose={ws.closeSidebar}
        onToggleFile={ws.toggleSidebarFile}
        onOpenFile={ws.openDrawer}
        onAnalyze={ws.runBulk}
        onToggleGroup={ws.toggleSidebarGroup}
        onSearchChange={ws.setSidebarSearch}
        onToggleAddOpen={ws.toggleSidebarAddOpen}
        onCloseAddOpen={ws.closeSidebarAddOpen}
        onSelectProject={ws.sidebarAddToProject}
        onCreateProject={ws.sidebarCreateProject}
        onSetViewMode={ws.setSidebarViewMode}
      />

      <BulkAiPanel
        show={ws.bulkShow}
        idle={ws.bulkIdle}
        selectedIds={ws.bulkSelectedIds}
        thumbs={ws.bulkThumbs}
        bulkOps={ws.bulkOps}
        bulkLangs={ws.bulkLangs}
        bulkStyle={ws.bulkStyle}
        proc={ws.proc}
        onClear={ws.clearSelection}
        onToggleCaptions={ws.toggleBulkCaptions}
        onToggleTags={ws.toggleBulkTags}
        onToggleLang={ws.toggleBulkLang}
        onSetStyle={ws.setBulkStyle}
        onRun={ws.runBulk}
      />

      {ws.projectMode && (
        <ImportModal
          open={ws.impOpen}
          onClose={ws.closeImport}
          projectId={ws.projCurrent}
          projectName={ws.projLabel}
          onBatchStart={ws.onUploadBatchStart}
          onBatchSettled={ws.onUploadBatchSettled}
        />
      )}

      <UploadManager
        projectId={ws.projCurrent}
        disabled={ws.impOpen || ws.allFilesMode}
        disabledMessage={ws.allFilesMode ? "OPEN A PROJECT TO UPLOAD" : undefined}
        onBatchStart={ws.onUploadBatchStart}
        onBatchSettled={ws.onUploadBatchSettled}
      />

      <CreateHubDialog
        open={outputUi === "hub" && Boolean(bd.activeBoard)}
        boardName={bd.activeBoard?.name ?? "Workspace"}
        drafts={drafts}
        currentAssetIds={orderedBoardAssetIds}
        photos={ws.photos}
        onClose={() => setOutputUi("closed")}
        onPickKind={(kind) => {
          setGenerationError(null);
          setCreateSeed(null);
          setBriefKind(kind);
          setOutputUi("brief");
        }}
        onOpenDraft={openDraft}
      />

      <CreateOutputDialog
        key={`${bd.activeBoardId ?? "none"}:${briefKind}:${createSeed ? activeDraft?.id ?? "seed" : "new"}`}
        open={outputUi === "brief" && Boolean(bd.activeBoard)}
        kind={briefKind}
        boardName={bd.activeBoard?.name ?? "Workspace"}
        allAssetIds={orderedBoardAssetIds}
        selectedAssetIds={orderedSelectedIds}
        threads={threads}
        busy={generationBusy}
        error={generationError}
        initial={createSeed}
        onClose={() => setOutputUi("hub")}
        onGenerate={(input) => void generateOutput(input)}
      />

      <ContentDraftStudio
        key={activeDraft?.id ?? "closed-draft"}
        draft={outputUi === "studio" ? activeDraft : null}
        suspended={draftConfirm !== null || shareOpen || ws.exportOpen}
        photos={ws.photos}
        currentAssetIds={orderedBoardAssetIds}
        saveState={draftSaveState}
        onChange={editDraft}
        onClose={closeStudio}
        onDelete={() => setDraftConfirm("delete")}
        onRegenerate={(draft) => {
          if (draft.hasManualEdits) {
            setDraftConfirm("regenerate");
            return;
          }
          setCreateSeed(regenerationSeed(draft));
          setBriefKind(draft.kind);
          setGenerationError(null);
          setOutputUi("brief");
        }}
        onShare={openSharePreview}
        onDownloadCopy={() => activeDraft && downloadContentDraft(activeDraft, ws.photos)}
        // Opens OVER the studio (the same suspension Share uses) — a delivery
        // must not close the editor it delivers from.
        onDownloadPhotos={(assetIds) => ws.openExportFor(assetIds)}
      />

      {/* After the studio in the tree: both sit at Z.modal, so DOM order is
          what puts the download card above a suspended editor. */}
      {ws.exportOpen && (
        <ExportDialog
          assetIds={ws.exportIds}
          photos={ws.photos}
          defaultTitle={bd.activeBoard?.name ?? (ws.projLabel === "Projects" ? "" : ws.projLabel)}
          workspaceId={workspaceId}
          onClose={ws.closeExport}
        />
      )}

      <SharePreviewDialog
        open={shareOpen && activeDraft !== null}
        draftName={activeDraft?.name ?? "Draft"}
        draftKind={activeDraft?.kind ?? "article"}
        busy={shareBusy}
        error={shareError}
        result={shareResult}
        resultOutdated={Boolean(activeDraft && shareResult && sharedDraftVersion !== activeDraft.version)}
        resultEnded={Boolean(shareResult && draftShareLinks && !draftShareLinks.some((link) => link.shareId === shareResult.shareId))}
        unmanagedShares={draftShareLinks?.filter((link) => link.shareId !== shareResult?.shareId) ?? []}
        onClose={() => {
          if (shareBusy) return;
          setShareOpen(false);
          setShareError(null);
        }}
        onCreate={(options) => void createSharePreview(options)}
        onRevoke={(shareId) => void revokeSharePreview(shareId)}
        onDismissResult={dismissShareResult}
      />

      <ConfirmModal
        open={draftConfirm === "delete" && activeDraft !== null}
        title={`Delete “${activeDraft?.name ?? "draft"}”?`}
        body={(draftShareLinks ? draftShareLinks.length > 0 : Boolean(shareResult))
          ? "This deletes the draft and everything written in it. Its public preview link stays live until you turn it off, so revoke it first if people should lose access. The Workspace and photos are not affected."
          : "This deletes the draft and everything written in it. The Workspace and its photos are not affected."}
        confirmLabel="Delete draft"
        danger
        onConfirm={deleteActiveDraft}
        onClose={() => setDraftConfirm(null)}
      />

      <ConfirmModal
        open={draftConfirm === "regenerate" && activeDraft !== null}
        title="Generate a new version?"
        body="Your edited draft stays saved. ArchiveMind will create a separate version from the same source snapshot."
        confirmLabel="Continue"
        onConfirm={() => {
          const draft = activeDraft;
          if (!draft) return;
          setDraftConfirm(null);
          setCreateSeed(regenerationSeed(draft));
          setBriefKind(draft.kind);
          setGenerationError(null);
          setOutputUi("brief");
        }}
        onClose={() => setDraftConfirm(null)}
      />

      <EdgeDropMenu menu={ws.edgeDropMenu} onPick={() => ws.spawnWiredNote()} onClose={ws.closeEdgeMenu} />

      <CanvasContextMenu
        menu={ws.contextMenu}
        allFilesMode={ws.allFilesMode}
        isCanvasView={ws.view === "neural"}
        selCount={ws.selectedIds.size}
        edgeSelected={ws.selectedEdgeId !== null}
        onRemoveEdge={() => {
          if (ws.selectedEdgeId) ws.deleteEdge(ws.selectedEdgeId);
        }}
        onClose={ws.closeContextMenu}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onToggleChat={ws.toggleChat}
        onToggleBulkPanel={ws.toggleBulkPanel}
        onExtractExif={ws.extractExif}
        onAdd={ws.addToolbar}
        onAddStickyNote={ws.addStickyNote}
        onPaste={ws.pasteFiles}
        clipboardCount={ws.clipboardCount}
        onGroup={ws.groupFiles}
        onFolder={ws.folderFiles}
        onExport={ws.exportFiles}
        onUngroup={ws.ungroupSelection}
        hasGroup={ws.selectionHasGroup}
        onBringToFront={ws.bringToFront}
        onBringForward={ws.bringForward}
        onSendBackward={ws.sendBackward}
        onSendToBack={ws.sendToBack}
        onDelete={ws.deleteFromContext}
        onFit={ws.onFit}
        labelNames={ws.labelNames}
        currentLabel={currentLabel}
        onPickLabel={(label) => ws.labelSelection(label, ws.contextMenu?.targetId ?? null)}
      />

      <PhotoDrawer
        photo={ws.drawerPhoto}
        lang={ws.drawerLang}
        style={ws.drawerStyle}
        copyLabel={ws.copyLabel}
        right={ws.drawerRight}
        onPrev={() => ws.navDrawer(-1)}
        onNext={() => ws.navDrawer(1)}
        onClose={ws.closeDrawer}
        onSetLang={ws.setLang}
        onSetStyle={ws.setStyle}
        onRegen={ws.regen}
        onCopy={ws.copyCap}
        onGenSingle={() => ws.drawerPhoto && ws.genSingle(ws.drawerPhoto.id)}
        onSaveCaption={ws.saveCaption}
        onSaveExif={ws.saveExif}
        onRevertExif={ws.revertExif}
        onEditImage={() => ws.drawerPhoto && ws.openEditor(ws.drawerPhoto.id)}
        onDelete={() => ws.drawerPhoto && ws.deletePhoto(ws.drawerPhoto.id)}
        onSetFactStatus={ws.setFactStatus}
        onExport={() => ws.drawerPhoto && ws.openExportFor([ws.drawerPhoto.id])}
        labelNames={ws.labelNames}
        // The drawer is about ONE photo, so it labels that photo even when a
        // selection is live — passing its id as the fallback would let a
        // stale canvas selection swallow the click.
        onPickLabel={(label) => ws.drawerPhoto && ws.labelOne(ws.drawerPhoto.id, label)}
      />

      <ImageEditor
        open={ws.editorOpen}
        photo={ws.editorPhoto}
        busy={ws.editBusy}
        onClose={ws.closeEditor}
        onSave={ws.saveEdit}
        onReset={ws.resetEdit}
      />

      {/* Big-selection delete guardrail (ADR 0033) — the same modal projects
          use, with copy that matches the real behavior: trash + 30 days. */}
      <ConfirmModal
        open={ws.confirmDeleteCount > 0}
        title={`Delete ${ws.confirmDeleteCount} files?`}
        body={`${ws.confirmDeleteCount} files will move to Trash and be permanently removed after 30 days. You can restore them from Trash until then.`}
        confirmLabel="Move to Trash"
        danger
        onConfirm={ws.confirmDeleteNow}
        onClose={ws.cancelConfirmDelete}
      />

      {/* Deleting a Workspace, both stakes. The reversible one names what
          survives, because "delete" over a set of files reads as deleting the
          files — the whole reason to spell it out is that it does not. */}
      <ConfirmModal
        open={confirmBoard !== null}
        title={
          boardConfirm?.mode === "purge"
            ? `Delete “${confirmBoard?.name ?? ""}” permanently?`
            : `Move “${confirmBoard?.name ?? ""}” to Trash?`
        }
        body={
          boardConfirm?.mode === "purge"
            ? `The workspace is removed for good. Its ${confirmBoard?.assetIds.length ?? 0} files stay in the project, and the notes and folders made in it move back to the project canvas. This cannot be undone.`
            : `The workspace stops showing in the header. Its ${confirmBoard?.assetIds.length ?? 0} files, notes and folders are kept, and you can restore all of it from Trash for 30 days.`
        }
        confirmLabel={boardConfirm?.mode === "purge" ? "Delete permanently" : "Move to Trash"}
        danger
        onConfirm={() => {
          if (!boardConfirm) return;
          if (boardConfirm.mode === "purge") {
            bd.purgeBoard(boardConfirm.id);
            ws.flashToast("Workspace deleted permanently");
          } else {
            const id = boardConfirm.id;
            bd.deleteBoard(id);
            // Undo rides on the toast, the way every other reversible delete in
            // the app does (ADR 0033). The header keeps ONE ↺ — the canvas undo
            // — because two identical arrows a few hundred pixels apart read as
            // one broken control, not as two different jobs.
            ws.flashToast(`${confirmBoard?.name ?? "Workspace"} moved to Trash`, {
              label: "Undo",
              onAction: () => bd.restoreBoard(id),
            });
          }
          setBoardConfirm(null);
        }}
        onClose={() => setBoardConfirm(null)}
      />

      {/* Action toasts (delete → Undo) render as the quiet bottom-left chip —
          they fire on every delete during normal culling and must not shout
          from the canvas center; plain confirmations/errors keep the
          attention spot under the header. */}
      <Toast
        show={ws.toast.show}
        text={ws.toast.text}
        actionLabel={ws.toast.actionLabel}
        onAction={ws.toast.onAction}
        variant={ws.toast.actionLabel ? "quiet" : "default"}
      />
    </div>
  );
}
