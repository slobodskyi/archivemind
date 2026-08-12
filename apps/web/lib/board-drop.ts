/** Dropping onto a Workspace chip (ADR 0044).
 *
 *  The canvas drives its own pointer drags rather than HTML5 drag-and-drop — it
 *  calls `preventDefault()` on pointerdown, so `dragover`/`drop` never fire and
 *  the header could not receive a drop the normal way. The chips are therefore
 *  found by hit-testing the pointer against the DOM, which is also what lets a
 *  drag that started on the canvas end on a `position: fixed` header.
 *
 *  `elementFromPoint` rather than cached rects: the chip row scrolls and
 *  overflows, so a rect captured at drag start would be wrong by the time the
 *  pointer arrives. */
export const BOARD_CHIP_ATTR = "data-board-chip";

export function boardChipAt(clientX: number, clientY: number): string | null {
  if (typeof document === "undefined") return null;
  const el = document.elementFromPoint(clientX, clientY);
  const chip = el?.closest(`[${BOARD_CHIP_ATTR}]`);
  const id = chip?.getAttribute(BOARD_CHIP_ATTR);
  // The "All files" entry carries the attribute with an empty value so hovering
  // it reads as "not a target" rather than as the previous chip still being armed.
  return id ? id : null;
}
