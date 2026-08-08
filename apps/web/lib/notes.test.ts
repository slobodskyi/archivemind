import { describe, expect, it } from "vitest";
import { hasChecklist, parseNoteLines, toggleChecklistLine } from "./notes";

describe("parseNoteLines", () => {
  it("reads an unticked and a ticked box, in either case", () => {
    expect(parseNoteLines("[ ] call the desk\n[x] file the take\n[X] invoice")).toEqual([
      { index: 0, checked: false, text: "call the desk" },
      { index: 1, checked: true, text: "file the take" },
      { index: 2, checked: true, text: "invoice" },
    ]);
  });

  it("leaves prose alone", () => {
    expect(parseNoteLines("just a note")).toEqual([{ index: 0, checked: null, text: "just a note" }]);
  });

  // The marker is anchored: a note ABOUT a checkbox must not sprout one.
  it("ignores a marker that isn't at the start of the line", () => {
    const [line] = parseNoteLines("ask if [x] means done");
    expect(line.checked).toBeNull();
    expect(line.text).toBe("ask if [x] means done");
  });

  it("keeps empty lines as lines, so indices match the raw text", () => {
    expect(parseNoteLines("[ ] a\n\n[ ] b").map((l) => l.checked)).toEqual([false, null, false]);
  });

  it("accepts an indented box and strips only the marker", () => {
    expect(parseNoteLines("   [ ]  double space")).toEqual([
      { index: 0, checked: false, text: " double space" },
    ]);
  });

  // `[]` is not the syntax — requiring the inner character keeps a typed-out
  // empty pair from silently becoming a control the user didn't ask for.
  it("does not treat an empty bracket pair as a box", () => {
    expect(parseNoteLines("[] nope")[0].checked).toBeNull();
  });
});

describe("toggleChecklistLine", () => {
  it("ticks and unticks", () => {
    expect(toggleChecklistLine("[ ] a", 0)).toBe("[x] a");
    expect(toggleChecklistLine("[x] a", 0)).toBe("[ ] a");
  });

  it("touches only the line asked for", () => {
    expect(toggleChecklistLine("[ ] a\n[ ] b\n[ ] c", 1)).toBe("[ ] a\n[x] b\n[ ] c");
  });

  // A toggle is not a licence to reformat what the user typed.
  it("preserves indentation and the gap after the marker", () => {
    expect(toggleChecklistLine("  [ ]   spaced", 0)).toBe("  [x]   spaced");
    expect(toggleChecklistLine("[ ]no gap", 0)).toBe("[x]no gap");
  });

  it("uppercase X unticks to a plain space", () => {
    expect(toggleChecklistLine("[X] a", 0)).toBe("[ ] a");
  });

  // A stale index (the text changed under a click) must be inert, not
  // destructive — the click simply does nothing.
  it("is a no-op on a non-checklist line or an index past the end", () => {
    expect(toggleChecklistLine("prose", 0)).toBe("prose");
    expect(toggleChecklistLine("[ ] a", 7)).toBe("[ ] a");
  });
});

describe("hasChecklist", () => {
  it("is true only when some line starts with a box", () => {
    expect(hasChecklist("plain\n[ ] one")).toBe(true);
    expect(hasChecklist("plain\nprose about [x]")).toBe(false);
    expect(hasChecklist("")).toBe(false);
  });
});
