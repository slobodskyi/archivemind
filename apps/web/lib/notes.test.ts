import { describe, expect, it } from "vitest";
import {
  flattenNoteEvidenceText,
  hasLineMarks,
  parseInline,
  parseNoteLines,
  toggleChecklistLine,
  toggleInlineMark,
  toggleLineStyle,
} from "./notes";

describe("parseNoteLines", () => {
  it("reads an unticked and a ticked box, in either case", () => {
    expect(parseNoteLines("[ ] call the desk\n[x] file the take\n[X] invoice")).toEqual([
      { index: 0, kind: "checklist", checked: false, ordinal: null, text: "call the desk" },
      { index: 1, kind: "checklist", checked: true, ordinal: null, text: "file the take" },
      { index: 2, kind: "checklist", checked: true, ordinal: null, text: "invoice" },
    ]);
  });

  it("leaves prose alone", () => {
    expect(parseNoteLines("just a note")).toEqual([
      { index: 0, kind: "plain", checked: null, ordinal: null, text: "just a note" },
    ]);
  });

  it("reads title, bullet and numbered line marks", () => {
    expect(parseNoteLines("# Heading\n- one\n- two\n1. first\n2. second").map((l) => [l.kind, l.text, l.ordinal])).toEqual([
      ["title", "Heading", null],
      ["bullet", "one", null],
      ["bullet", "two", null],
      ["numbered", "first", 1],
      ["numbered", "second", 2],
    ]);
  });

  // A numbered run renders 1,2,3 no matter what digits were typed, and a break
  // resets the count.
  it("renumbers a numbered run and resets it after a gap", () => {
    expect(parseNoteLines("5. a\n5. b\nprose\n9. c").map((l) => l.ordinal)).toEqual([1, 2, null, 1]);
  });

  // The marker is anchored: a note ABOUT a checkbox must not sprout one.
  it("ignores a marker that isn't at the start of the line", () => {
    const [line] = parseNoteLines("ask if [x] means done");
    expect(line.checked).toBeNull();
    expect(line.kind).toBe("plain");
    expect(line.text).toBe("ask if [x] means done");
  });

  it("keeps empty lines as lines, so indices match the raw text", () => {
    expect(parseNoteLines("[ ] a\n\n[ ] b").map((l) => l.checked)).toEqual([false, null, false]);
  });

  it("accepts an indented box and strips only the marker", () => {
    expect(parseNoteLines("   [ ]  double space")).toEqual([
      { index: 0, kind: "checklist", checked: false, ordinal: null, text: " double space" },
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

describe("hasLineMarks", () => {
  it("is true when some line carries any line-level mark", () => {
    expect(hasLineMarks("plain\n[ ] one")).toBe(true);
    expect(hasLineMarks("plain\n# Heading")).toBe(true);
    expect(hasLineMarks("plain\n- bullet")).toBe(true);
    expect(hasLineMarks("plain\n1. numbered")).toBe(true);
    expect(hasLineMarks("plain\nprose about [x]")).toBe(false);
    expect(hasLineMarks("")).toBe(false);
  });
});

describe("parseInline", () => {
  it("splits bold and strikethrough spans", () => {
    expect(parseInline("a **bold** and ~~gone~~")).toEqual([
      { text: "a ", bold: false, strike: false },
      { text: "bold", bold: true, strike: false },
      { text: " and ", bold: false, strike: false },
      { text: "gone", bold: false, strike: true },
    ]);
  });

  // A lone marker with no partner is punctuation, not a format.
  it("leaves an unmatched marker as literal text", () => {
    expect(parseInline("2 ** 3 = ?")).toEqual([{ text: "2 ** 3 = ?", bold: false, strike: false }]);
  });
});

describe("toggleLineStyle", () => {
  it("adds a prefix to every line the selection touches", () => {
    const r = toggleLineStyle("a\nb", 0, 3, "bullet");
    expect(r.text).toBe("- a\n- b");
  });

  it("clears the prefix when every line already has it", () => {
    const r = toggleLineStyle("- a\n- b", 0, 6, "bullet");
    expect(r.text).toBe("a\nb");
  });

  it("regular strips whatever line mark is present", () => {
    expect(toggleLineStyle("# a", 0, 3, "regular").text).toBe("a");
    expect(toggleLineStyle("1. a", 0, 4, "regular").text).toBe("a");
  });

  it("leaves a checklist line alone", () => {
    expect(toggleLineStyle("[ ] a", 0, 5, "title").text).toBe("[ ] a");
  });
});

describe("toggleInlineMark", () => {
  it("wraps a selection", () => {
    const r = toggleInlineMark("hello", 0, 5, "**");
    expect(r.text).toBe("**hello**");
  });

  it("unwraps a selection that is already wrapped", () => {
    const r = toggleInlineMark("**hi**", 0, 6, "**");
    expect(r.text).toBe("hi");
  });

  it("inserts an empty pair and puts the caret between them", () => {
    const r = toggleInlineMark("", 0, 0, "~~");
    expect(r.text).toBe("~~~~");
    expect(r.selStart).toBe(2);
    expect(r.selEnd).toBe(2);
  });
});

describe("flattenNoteEvidenceText", () => {
  it("strips markers but keeps their text — an unticked reminder is authored intent", () => {
    expect(flattenNoteEvidenceText("# Focus\n[ ] ask about the dog\n- keep it warm")).toBe(
      "Focus\nask about the dog\nkeep it warm",
    );
  });

  it("drops struck spans — a strike is the author retracting something", () => {
    expect(flattenNoteEvidenceText("keep this ~~not this~~ and this")).toBe("keep this  and this");
  });

  it("drops blank lines and caps at the schema's per-note limit", () => {
    expect(flattenNoteEvidenceText("a\n\n\nb")).toBe("a\nb");
    expect(flattenNoteEvidenceText("x".repeat(2000))).toHaveLength(1500);
  });
});
