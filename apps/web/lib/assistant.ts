import type { AssetLabel, SearchParse } from "@archivemind/shared";
import type { ChatOffer, ChatResult, Photo, ViewMode } from "@/types";
import { unanalyzedInScope, type UnanalyzedScope } from "./unanalyzed";

/** The assistant's brain, minus the model and minus the doing.
 *
 *  Everything here is a pure function of a snapshot of the canvas: which
 *  buttons a set of search results gets, what a reply says, what the chat
 *  offers before anybody has typed. The rule the whole feature rests on is
 *  that the assistant PROPOSES and the app EXECUTES — these functions return
 *  `ChatAction` descriptions, and `runAction` (hooks/useAssistant) maps each
 *  onto a handler some button already calls. No write path starts here.
 *
 *  Gates are the canvas menu's own, restated once so a chip can never offer
 *  what the menu would refuse: Workspaces, Share and Trash exist only inside a
 *  project, and an action reaches only the photos this canvas draws (ADR 0040:
 *  what you cannot see you cannot act on). Deterministic — no clock, no random. */

export interface AssistantBoard {
  id: string;
  name: string;
  color: AssetLabel;
  assetIds: readonly string[];
}

export interface AssistantContext {
  /** Inside a project, not the workspace-wide `all` grid. */
  projectMode: boolean;
  view: ViewMode;
  /** The view switcher is on screen: a project, with no Workspace open. */
  canSwitchView: boolean;
  /** Ids this canvas draws: Workspace scope and label filter applied, and on
   *  the Canvas view minus the members of collapsed folders. */
  visibleIds: ReadonlySet<string>;
  /** Every loaded photo, drawn or not. */
  loadedIds: ReadonlySet<string>;
  /** Live Workspaces of this project; empty outside one. */
  boards: readonly AssistantBoard[];
  activeBoardId: string | null;
  /** What "Analyze N" would select — the AI panel intro's own computation. */
  unanalyzed: UnanalyzedScope;
  /** Drawn photos that ARE analyzed — the only ones a caption can be written
   *  for, since a caption is built from the facts analysis leaves behind. */
  analyzedIds: ReadonlySet<string>;
  /** An AI job is running: the panel will refuse to open for another. */
  jobActive: boolean;
  /** The archive's own most common tags — search examples that will match. */
  topTags: readonly string[];
  /** Drawn photos with / without a colour label. */
  labelled: number;
  unlabelled: number;
  labelFilter: AssetLabel | "none" | null;
  selectedIds: readonly string[];
}

export interface AssistantContextInput {
  projectMode: boolean;
  view: ViewMode;
  canSwitchView: boolean;
  /** Every loaded photo (`ws.photos`). */
  photos: readonly Photo[];
  /** Workspace scope + label filter (`ws.visiblePhotos`). */
  visiblePhotos: readonly Photo[];
  /** What the canvas draws (`ws.activePositions`), or null when the view draws
   *  every photo it is given — only the Canvas view hides folder members. */
  drawn: Readonly<Record<string, unknown>> | null;
  busy: ReadonlySet<string>;
  /** `ws.proc.active`. */
  jobActive: boolean;
  boards: readonly AssistantBoard[];
  activeBoardId: string | null;
  labelFilter: AssetLabel | "none" | null;
  selectedIds: Iterable<string>;
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function buildAssistantContext(input: AssistantContextInput): AssistantContext {
  const drawnPhotos = input.drawn
    ? input.visiblePhotos.filter((p) => hasOwn(input.drawn as object, p.id))
    : input.visiblePhotos;
  let labelled = 0;
  for (const p of drawnPhotos) if (p.label) labelled += 1;
  return {
    projectMode: input.projectMode,
    view: input.view,
    canSwitchView: input.canSwitchView,
    visibleIds: new Set(drawnPhotos.map((p) => p.id)),
    loadedIds: new Set(input.photos.map((p) => p.id)),
    boards: input.projectMode ? input.boards : [],
    activeBoardId: input.projectMode ? input.activeBoardId : null,
    unanalyzed: unanalyzedInScope(input.visiblePhotos, input.drawn, input.busy),
    analyzedIds: new Set(drawnPhotos.filter((p) => p.processed).map((p) => p.id)),
    jobActive: input.jobActive,
    topTags: topTags(drawnPhotos),
    labelled,
    unlabelled: drawnPhotos.length - labelled,
    labelFilter: input.labelFilter,
    selectedIds: [...input.selectedIds],
  };
}

/** The tags most photos share, as search examples. A tag carried by most of
 *  the archive ("outdoor" on a landscape shoot) finds everything and shows
 *  nothing, so past a handful of analyzed photos the near-universal ones are
 *  dropped — unless that would leave no example at all. Ties break by name. */
export function topTags(photos: readonly Pick<Photo, "tags">[], limit = 4): string[] {
  const counts = new Map<string, number>();
  let analyzed = 0;
  for (const p of photos) {
    if (!p.tags?.length) continue;
    analyzed += 1;
    for (const tag of new Set(p.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const ceiling = analyzed >= 5 ? analyzed * 0.6 : Infinity;
  const specific = ranked.filter(([, n]) => n <= ceiling);
  return (specific.length ? specific : ranked).slice(0, limit).map(([tag]) => tag);
}

// ── Actions on a set of search results ───────────────────────────────────────

export interface ResultBoardOption {
  id: string;
  name: string;
  color: AssetLabel;
  /** How many of the result ids the Workspace does not hold yet. 0 = all in. */
  missing: number;
}

export interface ResultActions {
  /** The results this canvas draws, deduped, search order kept — what every
   *  action in the row acts on. */
  ids: string[];
  /** Results that exist but are not drawn here (another project, outside the
   *  open Workspace, hidden by the label filter, beyond the loaded window). */
  outside: number;
  /** In an open Workspace: loaded results that are not members of it. The one
   *  action that reaches past what is drawn, because bringing them in is the
   *  only way to make them drawable. Null when there is nothing to bring in. */
  bringIn: { boardId: string; name: string; ids: string[] } | null;
  /** Other Workspaces of the project to add to; null outside a project. */
  boards: ResultBoardOption[] | null;
  canShare: boolean;
  canTrash: boolean;
}

export function resultActions(resultIds: readonly string[], ctx: AssistantContext): ResultActions {
  const unique = [...new Set(resultIds)];
  const ids = unique.filter((id) => ctx.visibleIds.has(id));
  const active = ctx.activeBoardId ? ctx.boards.find((b) => b.id === ctx.activeBoardId) : undefined;
  const members = active ? new Set(active.assetIds) : null;
  const strays = members ? unique.filter((id) => ctx.loadedIds.has(id) && !members.has(id)) : [];
  const bringIn = active && strays.length ? { boardId: active.id, name: active.name, ids: strays } : null;
  const boards = ctx.projectMode
    ? ctx.boards
        .filter((b) => b.id !== ctx.activeBoardId)
        .map((b) => {
          const held = new Set(b.assetIds);
          return { id: b.id, name: b.name, color: b.color, missing: ids.filter((id) => !held.has(id)).length };
        })
    : null;
  return {
    ids,
    outside: unique.length - ids.length,
    bringIn,
    boards,
    canShare: ctx.projectMode && ids.length > 0,
    canTrash: ctx.projectMode && ids.length > 0,
  };
}

// ── Replies ──────────────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** "Analyze N photos…" — the offer that replaces telling the user to go and
 *  find a ✨ badge. It opens the AI panel with its credit estimate; nothing
 *  runs until Run. Null when there is nothing ready to analyze. */
export function analyzeOffer(ctx: AssistantContext): ChatOffer | null {
  const n = ctx.unanalyzed.ids.length;
  if (n === 0) return null;
  return {
    label: `Analyze ${n} ${plural(n, "photo")}…`,
    action: { kind: "analyze", ids: [...ctx.unanalyzed.ids] },
    tone: "ai",
  };
}

/** Honest filter note (ADR 0029/0031): name only what actually filtered or
 *  matched a result — never the parsed wish-list. Dates, places and EXIF
 *  genuinely filter in SQL; tags and description text only rank, so they
 *  appear only when a returned result carries the match. */
export function filterNote(parsed: SearchParse, results: readonly ChatResult[]): string {
  const filters: string[] = [];
  if (parsed.date_from || parsed.date_to) filters.push(`dates ${parsed.date_from ?? "…"} – ${parsed.date_to ?? "…"}`);
  if (parsed.place_terms.length) filters.push(`place: ${parsed.place_terms.join(", ")}`);
  if (parsed.camera_terms.length) filters.push(`camera: ${parsed.camera_terms.join(", ")}`);
  if (parsed.iso_min || parsed.iso_max) filters.push(`ISO ${parsed.iso_min ?? "…"}–${parsed.iso_max ?? "…"}`);
  if (parsed.aperture) filters.push(`aperture ${parsed.aperture}`);
  const hitTags = [...new Set(results.flatMap((r) => r.matchedTags))];
  if (hitTags.length) filters.push(`tagged: ${hitTags.join(", ")}`);
  if (results.some((r) => r.matchedText)) filters.push("in description");
  return filters.length ? ` (${filters.join("; ")})` : "";
}

export interface AssistantReply {
  text: string;
  /** Small print above the offers; null when the text says it all. */
  note: string | null;
  offers: ChatOffer[];
}

/** What the assistant says about a finished search, and what it proposes.
 *
 *  Search only sees analyzed photos, so an unanalyzed pile is the commonest
 *  reason a query finds nothing — and the reply used to answer it with an
 *  instruction. Now it counts the pile and offers to analyze it. The count is
 *  over what this canvas draws, because that is all "Analyze N" can select. */
export function searchReply(parsed: SearchParse, results: readonly ChatResult[], ctx: AssistantContext): AssistantReply {
  const note = filterNote(parsed, results);
  const offer = analyzeOffer(ctx);
  const pending = ctx.unanalyzed.ids.length;
  const unseen = `${plural(pending, "isn't", "aren't")} analyzed yet, so search can't see ${plural(pending, "it", "them")}.`;

  if (results.length > 0) {
    const strong = results.filter((r) => r.tier === "strong").length;
    const weak = results.length - strong;
    return {
      text: `${strong} best ${plural(strong, "match", "matches")}${note}${weak ? ` — plus ${weak} more distant below` : ""}. Tap a thumb to open it.`,
      // The answer is what was found; what search could not see is an aside,
      // and reads as one — small print beside the button that fixes it.
      note: offer ? `${pending} ${plural(pending, "photo")} on this canvas ${unseen}` : null,
      offers: offer ? [offer] : [],
    };
  }
  if (offer) {
    const total = ctx.unanalyzed.total;
    return {
      // Here it IS the answer: the likeliest reason nothing matched.
      text: `No matches${note}. ${pending} of ${total} ${plural(total, "photo")} on this canvas ${unseen}`,
      note: null,
      offers: [offer],
    };
  }
  if (ctx.unanalyzed.total === 0) {
    return { text: `No matches${note}. There are no photos on this canvas yet.`, note: null, offers: [] };
  }
  return {
    text: `No matches${note}. Try different wording${ctx.topTags.length ? ", or one of these" : ""}.`,
    note: null,
    offers: ctx.topTags.map((tag) => ({ label: tag, action: { kind: "search", query: tag } })),
  };
}

/** What the chat offers before anything has been typed. The examples are the
 *  archive's own tags, so the first search a newcomer runs finds something —
 *  the four fixed English phrases this replaces matched nothing in most
 *  archives. With nothing analyzed there is nothing to search, and the only
 *  honest suggestion is the one that fixes that. */
export function starterSuggestions(ctx: AssistantContext): { note: string | null; offers: ChatOffer[] } {
  const offers: ChatOffer[] = [];
  const offer = analyzeOffer(ctx);
  const total = ctx.unanalyzed.total;
  const analyzed = total - ctx.unanalyzed.ids.length - ctx.unanalyzed.hidden - ctx.unanalyzed.pending;
  if (offer) offers.push(offer);
  for (const tag of ctx.topTags) offers.push({ label: tag, action: { kind: "search", query: tag } });
  // Only worth offering when it narrows something: an archive with no labels
  // at all, or with every photo labelled, has no untriaged pile to look at.
  if (ctx.labelFilter === null && ctx.labelled > 0 && ctx.unlabelled > 0) {
    offers.push({ label: `Show ${ctx.unlabelled} unlabelled`, action: { kind: "filter_label", filter: "none" } });
  }
  const note =
    total === 0
      ? "There are no photos on this canvas yet."
      : analyzed <= 0 && offer
        ? "Nothing here is analyzed yet — search only sees analyzed photos."
        : null;
  return { note, offers };
}
