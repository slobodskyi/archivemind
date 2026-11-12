/** Whether a key press belongs to an overlay rather than to the canvas behind it.
 *
 *  The workspace's shortcuts all listen on `window`, so they hear every key
 *  pressed anywhere, including inside a modal sitting over the canvas. They
 *  are: Delete/Backspace trash the selection, 1–7/0 label it, ⌘C/⌘V copy and
 *  paste it, F opens the viewer, Esc closes the topmost panel, and a held
 *  Space pans. Without this rule a Backspace in the Share dialog trashed the
 *  photos selected behind it, and Esc in the image editor closed the drawer
 *  along with the editor.
 *
 *  A modal owns the keyboard in one of two ways:
 *  - BY STATE, for the overlays that keep their own window listeners and may
 *    not hold focus: the fullscreen viewer (ADR 0054), the image editor
 *    (ADR 0030) and the import modal;
 *  - BY FOCUS, for every other one: a key pressed inside an element with
 *    role="dialog" was meant for that dialog. `useDialog` keeps focus inside a
 *    dialog, but stops only Escape from reaching the window. */
export function keysBelongToOverlay(
  open: { viewerId: string | null; editorId: string | null; importOpen: boolean },
  target: EventTarget | null,
): boolean {
  if (open.viewerId || open.editorId || open.importOpen) return true;
  const el = target as { closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === "function" && el.closest('[role="dialog"]') != null;
}
