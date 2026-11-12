"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssistantRequest, AssistantResponse, Board } from "@archivemind/shared";
import type { ChatAction, ChatMessage, ChatOffer, ChatResult } from "@/types";
import {
  buildAssistantContext,
  resultActions,
  starterSuggestions,
  type AssistantContext,
  type ResultActions,
} from "@/lib/assistant";
import { resolveIntent } from "@/lib/assistant-intent";
import { CHAT_GREETING } from "@/lib/chat";
import { photoSrc } from "@/lib/img";
import type { Workspace } from "./useWorkspace";

/** The assistant: the conversation, and the one place a `ChatAction` becomes
 *  something happening.
 *
 *  A message goes to `POST /api/assistant`, which answers with an INTENT — a
 *  search, or a command naming an action and the photos it is about — and
 *  never with a deed. lib/assistant-intent turns that into a reply and,
 *  when the photos are ones the user has already seen, a `ChatAction` to run.
 *
 *  It owns no capability of its own. `runAction` forwards each action to the
 *  handler a button elsewhere already calls — the board hook, the Share and
 *  Download dialogs, the AI panel, the label write, the Trash confirm — so
 *  whatever those enforce (the single-job lock, the credit estimate before
 *  Run, RLS on the route) is enforced here by construction. What decides
 *  WHICH actions exist for a set of results is lib/assistant, pure and tested.
 *
 *  The execution rule, in one place:
 *  - reversible and free (select, view, add to a Workspace, label, filter,
 *    switch view) runs at once, behind the Undo its handler already offers;
 *  - anything that spends credits opens the AI panel and stops there;
 *  - anything that leaves the app opens its own dialog (Share, Download);
 *  - Trash always asks.
 *
 *  It lives outside useWorkspace because half of what it drives does:
 *  Workspaces, Share and the AI panel's focus are ArchiveWorkspace's. */

type Ws = Pick<
  Workspace,
  | "photos"
  | "visiblePhotos"
  | "activePositions"
  | "aiBusyIds"
  | "view"
  | "projectMode"
  | "showViewTabs"
  | "selectedIds"
  | "proc"
  | "labelFilter"
  | "labelNames"
  | "flashToast"
  | "openExportFor"
  | "selectIds"
  | "viewIds"
  | "labelIds"
  | "confirmDelete"
  | "setLabelFilter"
  | "setView"
>;

export interface AssistantDeps {
  /** The panel is on screen — the render-time context is only built then. */
  open: boolean;
  /** A project id, or "all" for the workspace-wide grid. */
  currentProjectId: string;
  ws: Ws;
  boards: readonly Board[];
  activeBoardId: string | null;
  addToBoard: (boardId: string, assetIds: string[]) => void;
  removeFromBoard: (boardId: string, assetIds: string[]) => void;
  createBoard: (name?: string, assetIds?: string[]) => void;
  openBoard: (id: string | null) => void;
  /** Open the Share dialog on these files (it starts on the narrowest scope). */
  openShare: (ids: readonly string[]) => void;
  /** Open the AI panel on these ids and move focus into it. Never runs AI.
   *  false = nothing opened, and a toast has said why. */
  openAi: (ids: readonly string[], mode: "analyze" | "caption") => boolean;
}

export interface Assistant {
  msgs: ChatMessage[];
  input: string;
  onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  send: (text?: string) => void;
  runAction: (action: ChatAction) => void;
  /** The action row for a set of result ids, against the canvas as it is now. */
  actionsFor: (resultIds: readonly string[]) => ResultActions;
  /** What the chat offers before anything is typed. */
  starter: { note: string | null; offers: ChatOffer[] };
}

const EMPTY_STARTER: Assistant["starter"] = { note: null, offers: [] };
/** A closed panel renders no result strip, so this is never drawn. */
const NO_ACTIONS: ResultActions = { ids: [], outside: 0, bringIn: null, boards: null, canShare: false, canTrash: false };

function contextOf(d: AssistantDeps): AssistantContext {
  return buildAssistantContext({
    projectMode: d.ws.projectMode,
    view: d.ws.view,
    canSwitchView: d.ws.showViewTabs && d.activeBoardId === null,
    photos: d.ws.photos,
    visiblePhotos: d.ws.visiblePhotos,
    // Only the Canvas view hides collapsed-folder members; the others draw
    // every photo they are given (the AI panel intro's own rule).
    drawn: d.ws.view === "neural" ? d.ws.activePositions : null,
    busy: d.ws.aiBusyIds,
    jobActive: d.ws.proc.active,
    boards: d.boards,
    activeBoardId: d.activeBoardId,
    labelFilter: d.ws.labelFilter,
    selectedIds: d.ws.selectedIds,
  });
}

const count = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

export function useAssistant(deps: AssistantDeps): Assistant {
  // Callbacks read the canvas as it is when they RUN, not as it was when they
  // were created: a reply lands seconds after the question, and the photos,
  // the open Workspace or the selection may all have moved meanwhile.
  const latest = useRef(deps);
  useEffect(() => {
    latest.current = deps;
  });

  const seq = useRef(0);
  const nextId = useCallback(() => `m${(seq.current += 1)}`, []);

  const [msgs, setMsgs] = useState<ChatMessage[]>(() => [{ id: "m0", role: "assistant", text: CHAT_GREETING }]);
  const [input, setInput] = useState("");
  const inputRef = useRef("");
  const busy = useRef(false);
  // "These" — the strong tier of the last answer that showed results. What a
  // typed "add these to Wedding" means when nothing else is named.
  const lastResults = useRef<string[]>([]);
  // `send` runs an action it resolved; `runAction` sends a search. A ref
  // breaks the circle, the same way ArchiveWorkspace ties `ws` to `bd`.
  const runRef = useRef<(action: ChatAction) => void>(() => {});

  const say = useCallback(
    (text: string, offers: ChatOffer[] = []) =>
      setMsgs((m) => [...m, { id: nextId(), role: "assistant", text, ...(offers.length ? { offers } : {}) }]),
    [nextId],
  );

  const send = useCallback(
    async (text?: string) => {
      const t = (typeof text === "string" ? text : inputRef.current).trim();
      // Under two characters the route refuses; there is nothing to ask yet.
      if (t.length < 2 || busy.current) return;
      busy.current = true;
      const userId = nextId();
      const replyId = nextId();
      setMsgs((m) => [
        ...m,
        { id: userId, role: "user", text: t },
        { id: replyId, role: "assistant", text: "Working on it…" },
      ]);
      inputRef.current = "";
      setInput("");
      // Patch by id: something else (a finished analysis) may have been
      // appended while the request was in flight.
      const answer = (next: Pick<ChatMessage, "text" | "results" | "note" | "offers">) =>
        setMsgs((m) => m.map((x) => (x.id === replyId ? { id: replyId, role: "assistant", ...next } : x)));
      try {
        const asked = latest.current;
        const body: AssistantRequest = {
          message: t.slice(0, 500),
          ...(asked.currentProjectId !== "all" ? { projectId: asked.currentProjectId } : {}),
          // What the model cannot see and needs: Workspace NAMES (so it can
          // spell one), and whether "these" has anything to point at.
          context: {
            workspaces: asked.ws.projectMode ? asked.boards.slice(0, 60).map((b) => b.name.slice(0, 200)) : [],
            hasResults: lastResults.current.length > 0,
            selectionCount: asked.ws.selectedIds.size,
          },
        };
        const resp = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) throw new Error(String(resp.status));
        const data = (await resp.json()) as AssistantResponse;

        const now = latest.current;
        const byId = new Map(now.ws.photos.map((p) => [p.id, p]));
        const results: ChatResult[] = (data.results ?? []).map((r) => {
          const p = byId.get(r.assetId);
          return {
            assetId: r.assetId,
            src: p ? photoSrc(p, 76, 76) : undefined,
            filename: p?.filename ?? "outside this view",
            tier: r.tier,
            matchedTags: r.matchedTags,
            matchedPlace: r.matchedPlace,
            matchedText: r.matchedText,
          };
        });
        const outcome = resolveIntent(data.intent, {
          ctx: contextOf(now),
          lastResultIds: lastResults.current,
          found: data.results ? results : null,
          parsed: data.parsed,
          labelNames: now.ws.labelNames,
        });
        const shown = outcome.showResults && results.length > 0;
        answer({
          text: outcome.text,
          ...(shown ? { results } : {}),
          ...(outcome.note ? { note: outcome.note } : {}),
          ...(outcome.offers.length ? { offers: outcome.offers } : {}),
        });
        if (shown) lastResults.current = results.filter((r) => r.tier === "strong").map((r) => r.assetId);
        // Set only for photos already seen (lib/assistant-intent); a
        // credit-spending or outward action still stops at its own panel.
        if (outcome.run) runRef.current(outcome.run);
      } catch {
        answer({ text: "I couldn't reach the assistant just now — try again in a moment." });
      } finally {
        busy.current = false;
      }
    },
    [nextId],
  );

  // "Analyze N" only OPENS the panel; the user may run it, change it or close
  // it. So the follow-up is tied to the outcome, not to the click: once a job
  // has run and some of the offered photos come back analyzed, say so.
  const awaiting = useRef<{ ids: string[]; ran: boolean } | null>(null);
  const procActive = deps.ws.proc.active;
  const photos = deps.ws.photos;
  useEffect(() => {
    const w = awaiting.current;
    if (!w) return;
    if (procActive) {
      w.ran = true;
      return;
    }
    if (!w.ran) return;
    const analyzed = new Set(photos.filter((p) => p.processed).map((p) => p.id));
    const done = w.ids.filter((id) => analyzed.has(id)).length;
    // Zero means the refreshed photos have not arrived yet, or the job failed
    // (its own toast said so) — either way there is nothing true to announce.
    if (done === 0) return;
    awaiting.current = null;
    const examples = contextOf(latest.current).topTags.slice(0, 3);
    say(
      `Analysis finished — ${count(done)} ${done === 1 ? "is" : "are"} now searchable.${examples.length ? " Try one of these." : ""}`,
      examples.map((tag) => ({ label: tag, action: { kind: "search", query: tag } })),
    );
  }, [procActive, photos, say]);

  const runAction = useCallback(
    (action: ChatAction) => {
      const d = latest.current;
      const { ws } = d;
      switch (action.kind) {
        case "search":
          void send(action.query);
          return;
        case "select":
          ws.selectIds(action.ids);
          return;
        case "view":
          ws.viewIds(action.ids);
          return;
        case "label":
          ws.labelIds(action.ids, action.label);
          return;
        case "download":
          ws.openExportFor(action.ids);
          return;
        case "share":
          if (ws.projectMode) d.openShare(action.ids);
          return;
        case "trash":
          if (ws.projectMode) ws.confirmDelete(action.ids);
          return;
        case "analyze":
          if (d.openAi(action.ids, "analyze")) awaiting.current = { ids: [...action.ids], ran: false };
          return;
        case "caption":
          d.openAi(action.ids, "caption");
          return;
        case "add_to_board": {
          if (!ws.projectMode || action.ids.length === 0) return;
          if (action.boardId === null) {
            // Same two steps as the canvas menu's "New workspace": the board
            // opens itself once the server answers, and it opens on its Canvas.
            d.createBoard(action.name, action.ids);
            ws.setView("neural");
            return;
          }
          const board = d.boards.find((b) => b.id === action.boardId);
          if (!board) return;
          const held = new Set(board.assetIds);
          const fresh = action.ids.filter((id) => !held.has(id));
          if (fresh.length === 0) {
            ws.flashToast(`Already in ${board.name}`);
            return;
          }
          d.addToBoard(board.id, fresh);
          // Undo removes exactly what this added — never a photo that was
          // already a member before the click.
          ws.flashToast(`Added ${fresh.length} to ${board.name}`, {
            label: "Undo",
            onAction: () => latest.current.removeFromBoard(board.id, fresh),
          });
          return;
        }
        case "filter_label":
          // setLabelFilter TOGGLES when handed the filter already on.
          if (ws.labelFilter !== action.filter) ws.setLabelFilter(action.filter);
          return;
        case "set_view":
          if (ws.showViewTabs && d.activeBoardId === null) ws.setView(action.view);
          return;
        case "open_board":
          if (ws.projectMode) d.openBoard(action.boardId);
          return;
      }
    },
    [send],
  );

  useEffect(() => {
    runRef.current = runAction;
  }, [runAction]);

  const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    inputRef.current = e.target.value;
    setInput(e.target.value);
  }, []);

  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void send();
      }
    },
    [send],
  );

  // Render-time context, for the suggestions and each result strip's action
  // row. Built only while the panel is open — a closed chat costs nothing.
  const { open, ws, boards, activeBoardId } = deps;
  const { projectMode, view, showViewTabs, visiblePhotos, activePositions, aiBusyIds, labelFilter, selectedIds } = ws;
  const ctx = useMemo(
    () =>
      open
        ? buildAssistantContext({
            projectMode,
            view,
            canSwitchView: showViewTabs && activeBoardId === null,
            photos,
            visiblePhotos,
            drawn: view === "neural" ? activePositions : null,
            busy: aiBusyIds,
            jobActive: procActive,
            boards,
            activeBoardId,
            labelFilter,
            selectedIds,
          })
        : null,
    [open, projectMode, view, showViewTabs, photos, visiblePhotos, activePositions, aiBusyIds, procActive, boards, activeBoardId, labelFilter, selectedIds],
  );

  const actionsFor = useCallback(
    (resultIds: readonly string[]) => (ctx ? resultActions(resultIds, ctx) : NO_ACTIONS),
    [ctx],
  );
  const starter = useMemo(() => (ctx ? starterSuggestions(ctx) : EMPTY_STARTER), [ctx]);

  return { msgs, input, onInput, onKey, send, runAction, actionsFor, starter };
}
