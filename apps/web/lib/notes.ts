/** Sticky-note text formatting (ADR 0041).
 *
 *  A note's body stays a plain string. Every formatting mark is markdown-ish
 *  syntax the renderer recognises — never a stored block model — which is what
 *  keeps undo, the debounced autosave and a half-typed line from having to know
 *  anything about it. Type the marker and you get the format; delete it and you
 *  have prose again, with no mode to leave.
 *
 *  Line-level marks (one per line, at the very start):
 *    `[ ]` / `[x]`  checklist item
 *    `# `           title (a heading — the "title" text style)
 *    `- `           bullet-list item
 *    `1. `          numbered-list item (any digits + `. `)
 *  Inline marks (anywhere in a line):
 *    `**bold**`     bold  (the "bold" text style)
 *    `~~strike~~`   strikethrough
 *
 *  Pure and deterministic, like everything in lib/layout.ts — the renderer and
 *  the toggles both go through here so a mark can never be drawn from one
 *  reading of a line and edited according to another. */

export type NoteLineKind = "checklist" | "title" | "bullet" | "numbered" | "plain";

export interface NoteLine {
  /** Index in the raw text's line array — what the toggles take. */
  index: number;
  kind: NoteLineKind;
  /** Checklist tick state; null for every other kind. */
  checked: boolean | null;
  /** Rendered ordinal for numbered lines (recomputed per contiguous run so a
   *  list always reads 1,2,3 regardless of the digits actually typed); null
   *  otherwise. */
  ordinal: number | null;
  /** The line with its leading marker stripped. */
  text: string;
}

/** `[ ]`, `[x]` or `[X]` at the very start of a line, with optional leading
 *  space and one optional space after. Anchored on purpose: a `[x]` in the
 *  middle of a sentence is prose about a checkbox, not a checkbox. */
const CHECK = /^(\s*)\[([ xX])\](\s?)(.*)$/;
const TITLE = /^(\s*)#[ \t]+(.*)$/;
const BULLET = /^(\s*)[-*][ \t]+(.*)$/;
const NUMBER = /^(\s*)\d+\.[ \t]+(.*)$/;

export function parseNoteLines(text: string): NoteLine[] {
  const rawLines = text.split("\n");
  let run = 0; // ordinal counter for the current numbered-list run
  return rawLines.map((line, index) => {
    const check = CHECK.exec(line);
    if (check) {
      run = 0;
      return { index, kind: "checklist" as const, checked: check[2] !== " ", ordinal: null, text: check[4] };
    }
    const title = TITLE.exec(line);
    if (title) {
      run = 0;
      return { index, kind: "title" as const, checked: null, ordinal: null, text: title[2] };
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      run = 0;
      return { index, kind: "bullet" as const, checked: null, ordinal: null, text: bullet[2] };
    }
    const number = NUMBER.exec(line);
    if (number) {
      run += 1;
      return { index, kind: "numbered" as const, checked: null, ordinal: run, text: number[2] };
    }
    run = 0;
    return { index, kind: "plain" as const, checked: null, ordinal: null, text: line };
  });
}

/** Flip one checklist line's box, preserving its exact indentation and spacing —
 *  the text is what the user typed and a toggle is not a licence to reformat it.
 *  A non-checklist line is returned untouched, so a stale index from a
 *  concurrent edit is a no-op rather than a corruption. */
export function toggleChecklistLine(text: string, index: number): string {
  const lines = text.split("\n");
  const line = lines[index];
  if (line === undefined) return text;
  const m = CHECK.exec(line);
  if (!m) return text;
  const [, indent, mark, gap, rest] = m;
  lines[index] = `${indent}[${mark === " " ? "x" : " "}]${gap}${rest}`;
  return lines.join("\n");
}

/** Does this note carry any line-level mark at all? Used only to decide whether
 *  the rendered body is worth building line-by-line. Bold/strike are inline and
 *  handled in the plain path, so they don't count here. */
export function hasLineMarks(text: string): boolean {
  return text.split("\n").some((line) => CHECK.test(line) || TITLE.test(line) || BULLET.test(line) || NUMBER.test(line));
}

// ── Inline marks ─────────────────────────────────────────────────────────────

export interface InlineSpan {
  text: string;
  bold: boolean;
  strike: boolean;
}

/** Split one line into styled spans. A single left-to-right pass over `**` and
 *  `~~`, non-nesting (a `**` inside a `~~` region is literal): a sticky note is
 *  not a document, and the toggles below only ever produce one level. An
 *  unmatched marker is left as literal text — a lone `**` is not a format. */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let bold = false;
  let strike = false;
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) spans.push({ text: buf, bold, strike });
    buf = "";
  };
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    // A marker toggles when it opens a region whose partner exists later, or
    // when it closes one already open. A lone marker with neither is literal
    // punctuation (a `**` a user typed with no partner).
    if (two === "**" && (bold || text.indexOf("**", i + 2) !== -1)) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (two === "~~" && (strike || text.indexOf("~~", i + 2) !== -1)) {
      flush();
      strike = !strike;
      i += 2;
      continue;
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return spans.length > 0 ? spans : [{ text: "", bold: false, strike: false }];
}

// ── Toolbar edits (operate on a <textarea> selection) ────────────────────────

export interface TextEdit {
  text: string;
  selStart: number;
  selEnd: number;
}

/** The line-level style a toolbar button applies. "regular" strips whatever
 *  line mark is present (title/bullet/numbered) — it is the way back to prose. */
export type LineStyle = "regular" | "title" | "bullet" | "numbered";

const LINE_PREFIX: Record<Exclude<LineStyle, "regular">, string> = {
  title: "# ",
  bullet: "- ",
  numbered: "1. ",
};

/** Strip any line-level style prefix (not the checklist box) from a single
 *  line, returning the bare text and how many characters were removed. */
function stripLinePrefix(line: string): { text: string; removed: number } {
  for (const re of [TITLE, BULLET, NUMBER]) {
    const m = re.exec(line);
    if (m) return { text: m[2], removed: line.length - m[2].length };
  }
  return { text: line, removed: 0 };
}

/** Apply (or, if already applied to every line, clear) a line style across the
 *  lines the selection touches. Idempotent per the button: pressing "bullet"
 *  on bulleted lines removes the bullets, matching how every list toggle in a
 *  text editor behaves. Checklist lines are left alone — the box is its own
 *  mark with its own toggle. */
export function toggleLineStyle(text: string, selStart: number, selEnd: number, style: LineStyle): TextEdit {
  const lines = text.split("\n");
  const startLine = text.slice(0, selStart).split("\n").length - 1;
  const endLine = text.slice(0, selEnd).split("\n").length - 1;

  const targets = lines.slice(startLine, endLine + 1).filter((l) => !CHECK.test(l));
  const prefix = style === "regular" ? "" : LINE_PREFIX[style];
  // Already fully applied → this press clears it (unless it's "regular", which
  // only ever strips).
  const allApplied =
    style !== "regular" && targets.length > 0 && targets.every((l) => l.trimStart().startsWith(prefix.trimEnd() + " ") || new RegExp(`^\\s*${style === "numbered" ? "\\d+\\." : style === "title" ? "#" : "[-*]"}[ \\t]+`).test(l));

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    if (CHECK.test(line)) continue;
    const bare = stripLinePrefix(line).text;
    lines[i] = style === "regular" || allApplied ? bare : prefix + bare;
  }
  const next = lines.join("\n");
  // Re-anchor the selection to the whole affected block — precise caret math
  // across variable-length prefix edits is not worth it for a sticky note.
  const before = lines.slice(0, startLine).join("\n");
  const start = startLine === 0 ? 0 : before.length + 1;
  const end = lines.slice(0, endLine + 1).join("\n").length;
  return { text: next, selStart: start, selEnd: end };
}

/** Wrap the selection in an inline marker, or unwrap it if it is already
 *  wrapped. An empty selection inserts the pair and puts the caret between them,
 *  so pressing Bold then typing writes bold text. */
export function toggleInlineMark(text: string, selStart: number, selEnd: number, marker: "**" | "~~"): TextEdit {
  const selected = text.slice(selStart, selEnd);
  const before = text.slice(0, selStart);
  const after = text.slice(selEnd);

  if (selStart === selEnd) {
    return { text: before + marker + marker + after, selStart: selStart + marker.length, selEnd: selStart + marker.length };
  }
  // Already wrapped by the selection itself, or wrapped just outside it.
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
    const inner = selected.slice(marker.length, selected.length - marker.length);
    return { text: before + inner + after, selStart, selEnd: selStart + inner.length };
  }
  if (before.endsWith(marker) && after.startsWith(marker)) {
    const nb = before.slice(0, before.length - marker.length);
    const na = after.slice(marker.length);
    return { text: nb + selected + na, selStart: selStart - marker.length, selEnd: selEnd - marker.length };
  }
  return { text: before + marker + selected + marker + after, selStart: selStart + marker.length, selEnd: selEnd + marker.length };
}

/** A note's body flattened for the generation prompt (ADR 0048 / ADR 0045 as
 *  amended): the markdown-ish text through the same parser the renderer uses,
 *  with `~~struck~~` spans DROPPED — a strike is the author retracting
 *  something, and evidence assembly must honour that. Checklist/bullet markers
 *  are stripped but their text kept: an unticked reminder is still authored
 *  intent. Capped at the schema's own per-note limit. */
export function flattenNoteEvidenceText(text: string): string {
  return parseNoteLines(text)
    .map((line) =>
      parseInline(line.text)
        .filter((span) => !span.strike)
        .map((span) => span.text)
        .join("")
        .trim(),
    )
    .filter(Boolean)
    .join("\n")
    .slice(0, 1_500);
}
