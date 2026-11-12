import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_NAMES,
  assistantIntentSchema,
  type AssistantIntent,
  type SearchParse,
} from "@archivemind/shared";
import type { ChatResult } from "@/types";
import type { AssistantBoard, AssistantContext } from "./assistant";
import { ASSISTANT_HELP, matchBoard, resolveIntent, type IntentEnv } from "./assistant-intent";

/** The context is a plain snapshot, so the tests write it out — no photos. */
function ctx(over: Partial<AssistantContext> = {}): AssistantContext {
  return {
    projectMode: true,
    view: "neural",
    canSwitchView: true,
    visibleIds: new Set(["a", "b", "c", "d"]),
    loadedIds: new Set(["a", "b", "c", "d", "e"]),
    boards: [],
    activeBoardId: null,
    unanalyzed: { ids: [], hidden: 0, pending: 0, total: 4 },
    analyzedIds: new Set(["a", "b", "c", "d"]),
    jobActive: false,
    topTags: ["dog"],
    labelled: 0,
    unlabelled: 4,
    labelFilter: null,
    selectedIds: [],
    ...over,
  };
}

const board = (id: string, name: string, assetIds: string[] = []): AssistantBoard => ({ id, name, color: "blue", assetIds });

const PARSE: SearchParse = {
  semantic_text: "dog",
  date_from: null,
  date_to: null,
  place_terms: [],
  tag_terms: [],
  camera_terms: [],
  iso_min: null,
  iso_max: null,
  aperture: null,
  kinds: [],
};

const hit = (assetId: string, tier: "strong" | "weak" = "strong"): ChatResult => ({
  assetId,
  filename: `${assetId}.jpg`,
  tier,
  matchedTags: [],
  matchedPlace: null,
  matchedText: false,
});

const intent = (raw: Partial<AssistantIntent>): AssistantIntent => assistantIntentSchema.parse(raw);

const env = (c: AssistantContext, over: Partial<IntentEnv> = {}): IntentEnv => ({
  ctx: c,
  lastResultIds: [],
  found: null,
  parsed: PARSE,
  labelNames: DEFAULT_LABEL_NAMES,
  ...over,
});

describe("matchBoard", () => {
  const boards = [board("1", "Wedding"), board("2", "Wedding — selects"), board("3", "Portfolio 2026"), board("4", "Весілля")];

  it("prefers an exact name over one that merely starts with it", () => {
    expect(matchBoard("wedding", boards)?.id).toBe("1");
  });

  it("ignores case, quotes and stray spaces", () => {
    expect(matchBoard('  "PORTFOLIO   2026" ', boards)?.id).toBe("3");
    expect(matchBoard("«весілля»", boards)?.id).toBe("4");
  });

  it("takes a prefix or a fragment only when exactly one Workspace fits", () => {
    expect(matchBoard("port", boards)?.id).toBe("3");
    expect(matchBoard("selects", boards)?.id).toBe("2");
    // "wed" starts two names: asking beats picking.
    expect(matchBoard("wed", boards)).toBeNull();
    expect(matchBoard("", boards)).toBeNull();
    expect(matchBoard("nothing like it", boards)).toBeNull();
  });
});

describe("resolveIntent — answers that need no photos", () => {
  it("a search is the search reply, with its results shown and nothing run", () => {
    const out = resolveIntent(intent({ action: "search" }), env(ctx(), { found: [hit("a"), hit("zz", "weak")] }));
    expect(out.text).toBe("1 best match — plus 1 more distant below. Tap a thumb to open it.");
    expect(out.showResults).toBe(true);
    expect(out.run).toBeNull();
  });

  it("help explains itself and offers real examples", () => {
    const out = resolveIntent(intent({ action: "help" }), env(ctx()));
    expect(out.text).toBe(ASSISTANT_HELP);
    expect(out.offers).toEqual([{ label: "dog", action: { kind: "search", query: "dog" } }]);
    expect(out.run).toBeNull();
  });

  it("switches view, mapping the on-screen name to the internal id", () => {
    expect(resolveIntent(intent({ action: "open_view", view: "map" }), env(ctx())).run).toEqual({ kind: "set_view", view: "map" });
    const topic = resolveIntent(intent({ action: "open_view", view: "topic" }), env(ctx()));
    expect(topic.run).toEqual({ kind: "set_view", view: "sense" });
    expect(topic.text).toBe("Switched to Topic.");
  });

  it("does not switch to the view it is on, and asks when none was named", () => {
    expect(resolveIntent(intent({ action: "open_view", view: "canvas" }), env(ctx())).run).toBeNull();
    const ask = resolveIntent(intent({ action: "open_view" }), env(ctx()));
    expect(ask.run).toBeNull();
    expect(ask.offers.map((o) => o.label)).toEqual(["Timeline", "Map", "Topic"]);
  });

  it("refuses a view switch where the switcher is hidden", () => {
    const inBoard = resolveIntent(
      intent({ action: "open_view", view: "map" }),
      env(ctx({ canSwitchView: false, activeBoardId: "1", boards: [board("1", "Wedding")] })),
    );
    expect(inBoard.run).toBeNull();
    expect(inBoard.offers).toEqual([{ label: "Leave the workspace", action: { kind: "open_board", boardId: null } }]);
    const allFiles = resolveIntent(intent({ action: "open_view", view: "map" }), env(ctx({ canSwitchView: false, projectMode: false })));
    expect(allFiles.run).toBeNull();
    expect(allFiles.offers).toEqual([]);
  });

  it("filters by a colour, by no label, and clears", () => {
    expect(resolveIntent(intent({ action: "filter_label", label: "red" }), env(ctx()))).toMatchObject({
      text: "Showing only Red photos.",
      run: { kind: "filter_label", filter: "red" },
    });
    expect(resolveIntent(intent({ action: "filter_label", label: "none" }), env(ctx())).run).toEqual({
      kind: "filter_label",
      filter: "none",
    });
    // Already on: running it again would TOGGLE the filter off.
    expect(resolveIntent(intent({ action: "filter_label", label: "red" }), env(ctx({ labelFilter: "red" }))).run).toBeNull();
    expect(resolveIntent(intent({ action: "filter_label" }), env(ctx({ labelFilter: "red" }))).run).toEqual({
      kind: "filter_label",
      filter: null,
    });
    const ask = resolveIntent(intent({ action: "filter_label" }), env(ctx()));
    expect(ask.run).toBeNull();
    expect(ask.offers).toHaveLength(8);
  });

  it("uses the workspace's own label names", () => {
    const names = { ...DEFAULT_LABEL_NAMES, red: "Selects" };
    const out = resolveIntent(intent({ action: "filter_label", label: "red" }), env(ctx(), { labelNames: names }));
    expect(out.text).toBe("Showing only Selects photos.");
  });

  it("opens a Workspace by name, and asks when the name fits none", () => {
    const boards = [board("1", "Wedding"), board("2", "Portfolio")];
    expect(resolveIntent(intent({ action: "open_workspace", workspace_name: "wedding" }), env(ctx({ boards }))).run).toEqual({
      kind: "open_board",
      boardId: "1",
    });
    const miss = resolveIntent(intent({ action: "open_workspace", workspace_name: "Zoo" }), env(ctx({ boards })));
    expect(miss.run).toBeNull();
    expect(miss.text).toBe("There's no workspace called “Zoo”.");
    expect(miss.offers.map((o) => o.label)).toEqual(["Wedding", "Portfolio"]);
    const open = resolveIntent(
      intent({ action: "open_workspace", workspace_name: "Wedding" }),
      env(ctx({ boards, activeBoardId: "1" })),
    );
    expect(open.run).toBeNull();
    expect(resolveIntent(intent({ action: "open_workspace", workspace_name: "x" }), env(ctx({ projectMode: false }))).run).toBeNull();
  });
});

describe("resolveIntent — analyze", () => {
  const pile = { ids: ["c", "d"], hidden: 0, pending: 0, total: 4 };

  it("opens the AI panel on everything unanalyzed", () => {
    const out = resolveIntent(intent({ action: "analyze", target: "all" }), env(ctx({ unanalyzed: pile })));
    expect(out.run).toEqual({ kind: "analyze", ids: ["c", "d"] });
    expect(out.text).toBe("Opening the AI panel for 2 photos. It shows the cost before anything runs.");
  });

  it("narrows to the selection when asked to", () => {
    const c = ctx({ unanalyzed: pile, selectedIds: ["a", "d"] });
    expect(resolveIntent(intent({ action: "analyze", target: "selection" }), env(c)).run).toEqual({ kind: "analyze", ids: ["d"] });
    const none = resolveIntent(intent({ action: "analyze", target: "selection" }), env(ctx({ unanalyzed: pile, selectedIds: ["a"] })));
    expect(none.run).toBeNull();
    expect(none.offers.map((o) => o.label)).toEqual(["Analyze 2 photos…"]);
  });

  it("says why when there is nothing to analyze, or a job is running", () => {
    expect(resolveIntent(intent({ action: "analyze" }), env(ctx())).text).toBe("Everything on this canvas is already analyzed.");
    const pending = ctx({ unanalyzed: { ids: [], hidden: 0, pending: 3, total: 4 } });
    expect(resolveIntent(intent({ action: "analyze" }), env(pending)).text).toBe(
      "Nothing is ready to analyze yet — 3 photos still being prepared.",
    );
    const busy = resolveIntent(intent({ action: "analyze" }), env(ctx({ unanalyzed: pile, jobActive: true })));
    expect(busy.run).toBeNull();
  });
});

describe("resolveIntent — acting on photos already seen", () => {
  const boards = [board("1", "Wedding", ["a"]), board("2", "Portfolio", ["a", "b"])];

  it("adds the last results to a named Workspace — only the ones it lacks", () => {
    const out = resolveIntent(
      intent({ action: "add_to_workspace", target: "last_results", workspace_name: "wedding" }),
      env(ctx({ boards }), { lastResultIds: ["a", "b", "zz"] }),
    );
    expect(out.run).toEqual({ kind: "add_to_board", ids: ["b"], boardId: "1" });
    expect(out.text).toBe("Adding 1 photo to Wedding.");
    expect(out.showResults).toBe(false);
  });

  it("does nothing when they are all members already", () => {
    const out = resolveIntent(
      intent({ action: "add_to_workspace", target: "last_results", workspace_name: "Portfolio" }),
      env(ctx({ boards }), { lastResultIds: ["a", "b"] }),
    );
    expect(out.run).toBeNull();
    expect(out.text).toBe("All 2 are already in Portfolio.");
  });

  it("offers to create a Workspace it cannot find, and never guesses one", () => {
    const out = resolveIntent(
      intent({ action: "add_to_workspace", target: "last_results", workspace_name: "Zoo" }),
      env(ctx({ boards }), { lastResultIds: ["a", "b"] }),
    );
    expect(out.run).toBeNull();
    expect(out.offers[0]).toEqual({
      label: "Create “Zoo” with these 2",
      action: { kind: "add_to_board", ids: ["a", "b"], boardId: null, name: "Zoo" },
    });
    expect(out.offers.slice(1).map((o) => o.label)).toEqual(["Add to Wedding", "Add to Portfolio"]);
  });

  it("asks which Workspace when none was named", () => {
    const out = resolveIntent(intent({ action: "add_to_workspace", target: "selection" }), env(ctx({ boards, selectedIds: ["c"] })));
    expect(out.run).toBeNull();
    expect(out.text).toBe("Which workspace for this photo?");
    expect(out.offers.map((o) => o.label)).toEqual(["Add to Wedding", "Add to Portfolio", "New workspace"]);
  });

  it("says so when there is nothing to act on", () => {
    expect(resolveIntent(intent({ action: "download", target: "last_results" }), env(ctx()))).toMatchObject({
      text: "There's no search answer to act on yet. Search for something, or select photos on the canvas.",
      run: null,
    });
    expect(resolveIntent(intent({ action: "download", target: "last_results" }), env(ctx(), { lastResultIds: ["zz"] })).text).toBe(
      "Those results aren't on this canvas any more.",
    );
    expect(resolveIntent(intent({ action: "download", target: "selection" }), env(ctx())).text).toBe("Nothing is selected on the canvas.");
  });

  it("labels the selection, removes a label, and asks for a colour it was not given", () => {
    const c = ctx({ selectedIds: ["a", "b", "hidden"] });
    expect(resolveIntent(intent({ action: "label", target: "selection", label: "red" }), env(c))).toMatchObject({
      text: "Marking 2 photos Red.",
      run: { kind: "label", ids: ["a", "b"], label: "red" },
    });
    expect(resolveIntent(intent({ action: "label", target: "selection", label: "none" }), env(c)).run).toEqual({
      kind: "label",
      ids: ["a", "b"],
      label: null,
    });
    const ask = resolveIntent(intent({ action: "label", target: "selection" }), env(c));
    expect(ask.run).toBeNull();
    expect(ask.offers).toHaveLength(8);
    expect(ask.offers[0]).toEqual({ label: "Red", action: { kind: "label", ids: ["a", "b"], label: "red" } });
  });

  it("sends Trash to its confirm, and refuses it — with Share — outside a project", () => {
    const c = ctx({ selectedIds: ["a"] });
    expect(resolveIntent(intent({ action: "trash", target: "selection" }), env(c))).toMatchObject({
      text: "Moving 1 photo to Trash — confirm in the dialog.",
      run: { kind: "trash", ids: ["a"] },
    });
    const allFiles = ctx({ selectedIds: ["a"], projectMode: false });
    expect(resolveIntent(intent({ action: "trash", target: "selection" }), env(allFiles)).run).toBeNull();
    expect(resolveIntent(intent({ action: "share", target: "selection" }), env(allFiles)).run).toBeNull();
    // Download changes nothing, so it works everywhere.
    expect(resolveIntent(intent({ action: "download", target: "selection" }), env(allFiles)).run).toEqual({
      kind: "download",
      ids: ["a"],
    });
  });

  it("captions only what is analyzed, and offers analysis when nothing is", () => {
    const c = ctx({ analyzedIds: new Set(["a"]), unanalyzed: { ids: ["b"], hidden: 0, pending: 0, total: 4 } });
    expect(resolveIntent(intent({ action: "caption", target: "last_results" }), env(c, { lastResultIds: ["a", "b"] })).run).toEqual({
      kind: "caption",
      ids: ["a"],
    });
    const none = resolveIntent(intent({ action: "caption", target: "last_results" }), env(c, { lastResultIds: ["b"] }));
    expect(none.run).toBeNull();
    expect(none.offers.map((o) => o.label)).toEqual(["Analyze 1 photo…"]);
  });

  it("“all” means every photo the canvas draws", () => {
    expect(resolveIntent(intent({ action: "select", target: "all" }), env(ctx())).run).toEqual({
      kind: "select",
      ids: ["a", "b", "c", "d"],
    });
    expect(resolveIntent(intent({ action: "view", target: "all" }), env(ctx({ visibleIds: new Set() }))).text).toBe(
      "There are no photos on this canvas yet.",
    );
  });
});

describe("resolveIntent — photos the message describes (never run, always offered)", () => {
  const boards = [board("1", "Pets", ["a"])];
  const found = [hit("a"), hit("b"), hit("zz"), hit("c", "weak")];

  it("shows the results and puts the action first among the offers", () => {
    const out = resolveIntent(
      intent({ action: "add_to_workspace", target: "new_search", workspace_name: "pets" }),
      env(ctx({ boards }), { found }),
    );
    expect(out.run).toBeNull();
    expect(out.showResults).toBe(true);
    expect(out.text).toBe("3 best matches — plus 1 more distant below. Tap a thumb to open it.");
    // Strong tier, drawn here, and not yet in the Workspace: just `b`.
    expect(out.offers).toEqual([{ label: "Add this photo to Pets", action: { kind: "add_to_board", ids: ["b"], boardId: "1" } }]);
  });

  it("never runs Trash on a set nobody has looked at", () => {
    const out = resolveIntent(intent({ action: "trash", target: "new_search" }), env(ctx(), { found }));
    expect(out.run).toBeNull();
    expect(out.offers[0]).toEqual({
      label: "Move these 2 to Trash…",
      action: { kind: "trash", ids: ["a", "b"] },
      tone: "danger",
    });
  });

  it("offers the command and nothing else — the analyze aside would read as its caption", () => {
    const c = ctx({ unanalyzed: { ids: ["d"], hidden: 0, pending: 0, total: 4 } });
    const out = resolveIntent(intent({ action: "select", target: "new_search" }), env(c, { found }));
    expect(out.offers.map((o) => o.label)).toEqual(["Select these 2"]);
    expect(out.note).toBeNull();
    // A plain search over the same canvas does carry it.
    expect(resolveIntent(intent({ action: "search" }), env(c, { found })).note).toBe(
      "1 photo on this canvas isn't analyzed yet, so search can't see it.",
    );
  });

  it("is a plain search answer when nothing matched, or nothing matched here", () => {
    const empty = resolveIntent(intent({ action: "share", target: "new_search" }), env(ctx(), { found: [] }));
    expect(empty.text).toBe("No matches. Try different wording, or one of these.");
    expect(empty.run).toBeNull();
    const elsewhere = resolveIntent(intent({ action: "share", target: "new_search" }), env(ctx(), { found: [hit("zz")] }));
    expect(elsewhere.offers).toEqual([]);
    expect(elsewhere.showResults).toBe(true);
  });

  it("asks about an unknown Workspace under the results, without running", () => {
    const out = resolveIntent(
      intent({ action: "add_to_workspace", target: "new_search", workspace_name: "Zoo" }),
      env(ctx({ boards }), { found }),
    );
    expect(out.text).toBe("3 best matches — plus 1 more distant below. Tap a thumb to open it. There's no workspace called “Zoo”.");
    expect(out.offers[0].label).toBe("Create “Zoo” with these 2");
    expect(out.showResults).toBe(true);
    expect(out.run).toBeNull();
  });
});
