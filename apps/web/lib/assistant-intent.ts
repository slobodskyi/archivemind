import { ASSET_LABELS, type AssetLabel, type AssistantIntent, type LabelNames, type SearchParse } from "@archivemind/shared";
import type { ChatAction, ChatOffer, ChatResult, ViewMode } from "@/types";
import {
  analyzeOffer,
  resultActions,
  searchReply,
  starterSuggestions,
  type AssistantBoard,
  type AssistantContext,
} from "./assistant";

/** A typed command, resolved: what the assistant says, and what it does.
 *
 *  The model has only named an intent ("add_to_workspace", target
 *  "last_results", workspace "Wedding"). This is where that becomes a
 *  `ChatAction` over real ids — or a question, or a refusal — against the
 *  canvas as it is. Pure, like lib/assistant: the model's answer and the
 *  snapshot go in, a description comes out, and hooks/useAssistant does the
 *  rest.
 *
 *  ONE rule decides whether the action runs or is merely offered (ADR 0056):
 *  **it runs only over photos the user has already seen** — the last answer,
 *  the selection, the canvas. When the message itself describes the photos
 *  ("add the dog photos to Pets") the search runs, the results are shown, and
 *  the action becomes the first button under them: nobody has looked at that
 *  set yet. "Runs" still means what it means for a button — a credit-spending
 *  action opens the AI panel, Share and Download open their dialogs, Trash
 *  opens its confirm. */

export interface IntentEnv {
  ctx: AssistantContext;
  /** Strong-tier ids of the last answer that showed results — "these". */
  lastResultIds: readonly string[];
  /** The search this message ran; null when it ran none. */
  found: readonly ChatResult[] | null;
  parsed: SearchParse;
  labelNames: LabelNames;
}

export interface IntentOutcome {
  text: string;
  note: string | null;
  offers: ChatOffer[];
  /** Attach this message's search results as a thumb strip. */
  showResults: boolean;
  /** Run now. Only ever set for photos the user has already seen. */
  run: ChatAction | null;
}

const VIEW_OF: Record<"canvas" | "timeline" | "map" | "topic", ViewMode> = {
  canvas: "neural",
  timeline: "timeline",
  map: "map",
  topic: "sense",
};
const VIEW_NAME: Record<ViewMode, string> = { neural: "Canvas", timeline: "Timeline", map: "Map", sense: "Topic" };
const VIEW_ORDER: ViewMode[] = ["neural", "timeline", "map", "sense"];

export const ASSISTANT_HELP =
  "I search your photos by what's in them, and act on what I find or what you've selected: add to a workspace, colour-label, share, download, write captions, open full screen, move to Trash. I can also analyze photos search can't see yet, filter by label and switch views. Say it in your own words — “add these to Wedding”, “show unlabelled”, “analyze everything”.";

const count = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;
const these = (n: number) => (n === 1 ? "this photo" : `these ${n}`);

const fold = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/["'“”«»‘’`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The Workspace a typed name means: an exact match, else the only one that
 *  starts with it, else the only one that contains it. Two candidates is no
 *  match — the assistant asks rather than picks, because adding to the wrong
 *  Workspace is the kind of mistake nobody notices. */
export function matchBoard(name: string, boards: readonly AssistantBoard[]): AssistantBoard | null {
  const want = fold(name);
  if (!want) return null;
  const exact = boards.find((b) => fold(b.name) === want);
  if (exact) return exact;
  const starts = boards.filter((b) => fold(b.name).startsWith(want));
  if (starts.length === 1) return starts[0];
  const holds = boards.filter((b) => fold(b.name).includes(want));
  return holds.length === 1 ? holds[0] : null;
}

const say = (text: string, offers: ChatOffer[] = [], run: ChatAction | null = null): IntentOutcome => ({
  text,
  note: null,
  offers,
  showResults: false,
  run,
});

const BOARD_OFFERS = 8;

export function resolveIntent(intent: AssistantIntent, env: IntentEnv): IntentOutcome {
  const { ctx } = env;
  switch (intent.action) {
    case "search":
      return { ...searchReply(env.parsed, env.found ?? [], ctx), showResults: true, run: null };

    case "help":
      return say(ASSISTANT_HELP, starterSuggestions(ctx).offers);

    case "open_view": {
      if (!ctx.canSwitchView) {
        return ctx.projectMode
          ? say("Views switch from the project canvas. Leave the workspace first.", [
              { label: "Leave the workspace", action: { kind: "open_board", boardId: null } },
            ])
          : say("Timeline, Map and Topic exist inside a project. Open one first.");
      }
      if (!intent.view) {
        return say(
          "Which view?",
          VIEW_ORDER.filter((v) => v !== ctx.view).map((v) => ({ label: VIEW_NAME[v], action: { kind: "set_view", view: v } })),
        );
      }
      const view = VIEW_OF[intent.view];
      if (view === ctx.view) return say(`You're already on ${VIEW_NAME[view]}.`);
      return say(`Switched to ${VIEW_NAME[view]}.`, [], { kind: "set_view", view });
    }

    case "filter_label": {
      const filter = intent.label ?? null;
      if (filter === null) {
        if (ctx.labelFilter !== null) return say("Showing everything again.", [], { kind: "filter_label", filter: null });
        return say("Which label?", [
          ...ASSET_LABELS.map((c): ChatOffer => ({ label: env.labelNames[c], action: { kind: "filter_label", filter: c } })),
          { label: "No label", action: { kind: "filter_label", filter: "none" } },
        ]);
      }
      const name = filter === "none" ? "photos with no label" : `${env.labelNames[filter]} photos`;
      if (ctx.labelFilter === filter) return say(`Already showing only ${name}.`);
      return say(`Showing only ${name}.`, [], { kind: "filter_label", filter });
    }

    case "open_workspace": {
      if (!ctx.projectMode) return say("Workspaces live inside a project. Open one first.");
      if (ctx.boards.length === 0) return say("This project has no workspaces yet.");
      const openOffers = ctx.boards
        .filter((b) => b.id !== ctx.activeBoardId)
        .slice(0, BOARD_OFFERS)
        .map((b): ChatOffer => ({ label: b.name, action: { kind: "open_board", boardId: b.id } }));
      if (!intent.workspace_name) return say("Which workspace?", openOffers);
      const board = matchBoard(intent.workspace_name, ctx.boards);
      if (!board) return say(`There's no workspace called “${intent.workspace_name}”.`, openOffers);
      if (board.id === ctx.activeBoardId) return say(`${board.name} is already open.`);
      return say(`Opening ${board.name}.`, [], { kind: "open_board", boardId: board.id });
    }

    case "analyze": {
      if (ctx.jobActive) return say("An AI job is already running. Ask again when it finishes.");
      const pool = ctx.unanalyzed.ids;
      const picked = new Set(ctx.selectedIds);
      const ids = intent.target === "selection" ? pool.filter((id) => picked.has(id)) : pool;
      if (ids.length === 0) {
        const offer = analyzeOffer(ctx);
        if (intent.target === "selection" && offer) return say("Nothing in the selection needs analysis.", [offer]);
        if (ctx.unanalyzed.total === 0) return say("There are no photos on this canvas yet.");
        if (ctx.unanalyzed.pending > 0) {
          return say(`Nothing is ready to analyze yet — ${count(ctx.unanalyzed.pending)} still being prepared.`);
        }
        return say("Everything on this canvas is already analyzed.");
      }
      return say(`Opening the AI panel for ${count(ids.length)}. It shows the cost before anything runs.`, [], {
        kind: "analyze",
        ids: [...ids],
      });
    }

    default:
      return targeted(intent, env);
  }
}

/** What to do with a concrete set of ids: the action, how to describe it once
 *  it is under way, and how to word it as a button. Or `ask` — a question or a
 *  refusal — when the intent cannot become an action as it stands. */
type Step =
  | { ask: IntentOutcome }
  | { action: ChatAction; doing: string; offer: string; tone?: ChatOffer["tone"] };

function stepFor(intent: AssistantIntent, ids: string[], env: IntentEnv): Step {
  const { ctx } = env;
  const n = ids.length;
  switch (intent.action) {
    case "select":
      return { action: { kind: "select", ids }, doing: `Selected ${count(n)} on the canvas.`, offer: `Select ${these(n)}` };
    case "view":
      return { action: { kind: "view", ids }, doing: `Opening ${count(n)} full screen.`, offer: `Open ${these(n)} full screen` };
    case "download":
      return { action: { kind: "download", ids }, doing: `Opening Download for ${count(n)}.`, offer: `Download ${these(n)}…` };
    case "share":
      if (!ctx.projectMode) return { ask: say("Share links belong to a project. Open one first.") };
      return { action: { kind: "share", ids }, doing: `Opening Share for ${count(n)}.`, offer: `Share ${these(n)}…` };
    case "trash":
      if (!ctx.projectMode) return { ask: say("Open a project to move photos to Trash.") };
      return {
        action: { kind: "trash", ids },
        doing: `Moving ${count(n)} to Trash — confirm in the dialog.`,
        offer: `Move ${these(n)} to Trash…`,
        tone: "danger",
      };
    case "caption": {
      if (ctx.jobActive) return { ask: say("An AI job is already running. Ask again when it finishes.") };
      const ready = ids.filter((id) => ctx.analyzedIds.has(id));
      if (ready.length === 0) {
        const offer = analyzeOffer(ctx);
        return { ask: say("Captions are written from a photo's analysis, and none of these are analyzed yet.", offer ? [offer] : []) };
      }
      return {
        action: { kind: "caption", ids: ready },
        doing: `Opening the AI panel to caption ${count(ready.length)}. It shows the cost before anything runs.`,
        offer: `Write captions for ${these(ready.length)}…`,
        tone: "ai",
      };
    }
    case "label": {
      const label = intent.label ?? null;
      if (label === null) {
        return {
          ask: say(`Which colour for ${these(n)}?`, [
            ...ASSET_LABELS.map((c): ChatOffer => ({ label: env.labelNames[c], action: { kind: "label", ids, label: c } })),
            { label: "Remove label", action: { kind: "label", ids, label: null } },
          ]),
        };
      }
      if (label === "none") {
        return {
          action: { kind: "label", ids, label: null },
          doing: `Removing the label from ${count(n)}.`,
          offer: `Remove the label from ${these(n)}`,
        };
      }
      const name = env.labelNames[label as AssetLabel];
      return { action: { kind: "label", ids, label }, doing: `Marking ${count(n)} ${name}.`, offer: `Mark ${these(n)} ${name}` };
    }
    case "add_to_workspace": {
      if (!ctx.projectMode) return { ask: say("Workspaces live inside a project. Open one first.") };
      const existing = ctx.boards
        .slice(0, BOARD_OFFERS)
        .map((b): ChatOffer => ({ label: `Add to ${b.name}`, action: { kind: "add_to_board", ids, boardId: b.id } }));
      const name = intent.workspace_name?.trim() ?? "";
      if (!name) {
        return {
          ask: say(`Which workspace for ${these(n)}?`, [
            ...existing,
            { label: "New workspace", action: { kind: "add_to_board", ids, boardId: null } },
          ]),
        };
      }
      const board = matchBoard(name, ctx.boards);
      if (!board) {
        return {
          ask: say(`There's no workspace called “${name}”.`, [
            { label: `Create “${name}” with ${these(n)}`, action: { kind: "add_to_board", ids, boardId: null, name } },
            ...existing,
          ]),
        };
      }
      const held = new Set(board.assetIds);
      const fresh = ids.filter((id) => !held.has(id));
      if (fresh.length === 0) return { ask: say(n === 1 ? `It's already in ${board.name}.` : `All ${n} are already in ${board.name}.`) };
      return {
        action: { kind: "add_to_board", ids: fresh, boardId: board.id },
        doing: `Adding ${count(fresh.length)} to ${board.name}.`,
        offer: `Add ${these(fresh.length)} to ${board.name}`,
      };
    }
    default:
      // search / help / open_view / filter_label / open_workspace / analyze
      // never reach here — resolveIntent answers them itself.
      return { ask: say(ASSISTANT_HELP) };
  }
}

function targeted(intent: AssistantIntent, env: IntentEnv): IntentOutcome {
  const { ctx } = env;

  // The message describes the photos itself: show what the search found and
  // OFFER the action. Nobody has seen this set yet, so nothing runs.
  if (intent.target === "new_search") {
    const found = env.found ?? [];
    const reply = searchReply(env.parsed, found, ctx);
    const strong = found.filter((r) => r.tier === "strong").map((r) => r.assetId);
    const ids = resultActions(strong, ctx).ids;
    if (ids.length === 0) return { ...reply, showResults: true, run: null };
    // One thing at a time: the message was a command, so the buttons under the
    // results are about THAT. The search reply's aside ("N aren't analyzed
    // yet", with its own button) is dropped here — set beside the command's
    // offers it read as their caption.
    const step = stepFor(intent, ids, env);
    if ("ask" in step) {
      return { text: `${reply.text} ${step.ask.text}`, note: null, offers: step.ask.offers, showResults: true, run: null };
    }
    return {
      text: reply.text,
      note: null,
      offers: [{ label: step.offer, action: step.action, ...(step.tone ? { tone: step.tone } : {}) }],
      showResults: true,
      run: null,
    };
  }

  let ids: string[];
  let empty: string;
  switch (intent.target) {
    case "last_results":
      ids = resultActions(env.lastResultIds, ctx).ids;
      empty = env.lastResultIds.length
        ? "Those results aren't on this canvas any more."
        : "There's no search answer to act on yet. Search for something, or select photos on the canvas.";
      break;
    case "selection":
      ids = ctx.selectedIds.filter((id) => ctx.visibleIds.has(id));
      empty = "Nothing is selected on the canvas.";
      break;
    case "unanalyzed":
      ids = [...ctx.unanalyzed.ids];
      empty = "Everything on this canvas is already analyzed.";
      break;
    default:
      ids = [...ctx.visibleIds];
      empty = "There are no photos on this canvas yet.";
  }
  if (ids.length === 0) return say(empty);

  const step = stepFor(intent, ids, env);
  if ("ask" in step) return step.ask;
  return say(step.doing, [], step.action);
}
