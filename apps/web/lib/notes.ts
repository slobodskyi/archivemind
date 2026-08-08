/** Sticky-note checklist lines (ADR 0041).
 *
 *  A note's body stays a plain string. The checkbox is markdown-ish syntax the
 *  renderer recognises — `[ ]` or `[x]` at the start of a line — and never a
 *  stored block model, which is what keeps undo, the debounced autosave and a
 *  half-typed line from having to know anything about it. Type `[ ] call the
 *  desk` and you have a checklist; delete the brackets and you have prose
 *  again, with no mode to leave.
 *
 *  Pure and deterministic, like everything in lib/layout.ts — the renderer and
 *  the toggle both go through here so a box can never be drawn from one reading
 *  of a line and ticked according to another. */

export interface NoteLine {
  /** Index in the raw text's line array — what `toggleChecklistLine` takes. */
  index: number;
  /** null = not a checklist line; otherwise its tick state. */
  checked: boolean | null;
  /** The line with the marker stripped (unchanged when `checked` is null). */
  text: string;
}

/** `[ ]`, `[x]` or `[X]` at the very start of a line, with optional leading
 *  space and one optional space after. Anchored on purpose: a `[x]` in the
 *  middle of a sentence is prose about a checkbox, not a checkbox. */
const MARKER = /^(\s*)\[([ xX])\](\s?)(.*)$/;

export function parseNoteLines(text: string): NoteLine[] {
  return text.split("\n").map((line, index) => {
    const m = MARKER.exec(line);
    if (!m) return { index, checked: null, text: line };
    return { index, checked: m[2] !== " ", text: m[4] };
  });
}

/** Flip one line's box, preserving its exact indentation and spacing — the text
 *  is what the user typed and a toggle is not a licence to reformat it. A line
 *  that is not a checklist line is returned untouched, so a stale index from a
 *  concurrent edit is a no-op rather than a corruption. */
export function toggleChecklistLine(text: string, index: number): string {
  const lines = text.split("\n");
  const line = lines[index];
  if (line === undefined) return text;
  const m = MARKER.exec(line);
  if (!m) return text;
  const [, indent, mark, gap, rest] = m;
  lines[index] = `${indent}[${mark === " " ? "x" : " "}]${gap}${rest}`;
  return lines.join("\n");
}

/** Does this note read as a checklist at all? Used only to decide whether the
 *  rendered body is worth building — a note with no boxes renders as plain text
 *  and skips the whole line-by-line pass. */
export function hasChecklist(text: string): boolean {
  return text.split("\n").some((line) => MARKER.test(line));
}
