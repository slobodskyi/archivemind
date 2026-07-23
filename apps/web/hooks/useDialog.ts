import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],area[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Accessible-dialog behaviour for a modal container (a11y audit): when `open`
 * turns true it moves focus into the dialog (preferring an element marked
 * `data-autofocus`, else the first focusable), traps Tab within it, closes on
 * Escape, and restores focus to the triggering element on close. The consumer
 * renders `role="dialog" aria-modal="true"` + a label on the returned ref'd
 * element and early-returns null while closed.
 *
 * Keyed on `open` (not mount): several shells stay mounted and merely render
 * null when closed, so a mount-once effect would never fire on open.
 */
export function useDialog<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const list = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));

    // Move focus in — the trigger keeps focus otherwise, so AT never learns a
    // dialog opened and Tab can wander behind the backdrop.
    (node.querySelector<HTMLElement>("[data-autofocus]") ?? list()[0] ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // don't also trip the workspace's window-level Esc
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = list();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return ref;
}
