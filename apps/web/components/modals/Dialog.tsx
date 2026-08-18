"use client";

import { useEffect, useId, type CSSProperties, type ReactNode, type RefObject, type ButtonHTMLAttributes } from "react";
import { useDialog } from "@/hooks/useDialog";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";

/** One dialog shell (2026-08-18 modal-consistency pass).
 *
 *  Before this, every dialog drew its own card: widths 380/420/520/600/620,
 *  radius 2 vs 4, background bg-sf vs bg-el, title 13/15/16, kicker present or
 *  absent, × present or absent, and footers that put the primary button on the
 *  left in one file and on the right in the next. This is the single card they
 *  all draw now:
 *
 *  - three widths — s 380 (confirms), m 520 (task dialogs), l 620 (forms and
 *    pickers); every card caps at calc(100vw - 32px) / calc(100dvh - 40px) and
 *    scrolls its BODY, never the page;
 *  - one header: optional small-caps kicker, 15/800 title, optional subtitle,
 *    an optional action slot, and the × close;
 *  - one footer rule: dismiss on the left, primary on the right, primary twice
 *    the width of a ghost (DialogButton encodes it);
 *  - the backdrop closes on pointerdown, not click — releasing a text-drag
 *    outside the card must not dismiss the dialog (a click's target is the
 *    common ancestor of down+up, which IS the backdrop in that case).
 *
 *  The studio (ContentDraftStudio) and ImportModal are working surfaces, not
 *  dialogs, and deliberately stay off this shell. */

export type DialogSize = "s" | "m" | "l";

const WIDTHS: Record<DialogSize, number> = { s: 380, m: 520, l: 620 };

const NOOP = () => {};

interface DialogProps {
  open: boolean;
  size?: DialogSize;
  /** Small-caps context line above the title, e.g. "ARTICLE PREVIEW". */
  kicker?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra control in the header row, left of the × (e.g. "+ Create"). */
  headerAction?: ReactNode;
  /** Hide the × for dialogs whose only exits are the footer buttons. */
  closeButton?: boolean;
  /** While true the backdrop, Escape and × are inert — a job is running and
   *  this dialog is the only place its outcome will appear. */
  busy?: boolean;
  /** id of the element that describes the dialog (aria-describedby). */
  describedById?: string;
  /** When this value changes, focus is re-anchored to the card's current
   *  [data-autofocus] if focus was lost — for dialogs whose phases unmount the
   *  focused control (see ExportDialog's config → working → ready). */
  refocusKey?: unknown;
  onClose: () => void;
  children: ReactNode;
  /** Merged over the scrollable body's base style (padding overrides etc.). */
  bodyStyle?: CSSProperties;
  footer?: ReactNode;
  /** Draw a hairline above the footer — for bodies that scroll under it. */
  footerSeparated?: boolean;
}

export default function Dialog({
  open,
  size = "m",
  kicker,
  title,
  subtitle,
  headerAction,
  closeButton = true,
  busy = false,
  describedById,
  refocusKey,
  onClose,
  children,
  bodyStyle,
  footer,
  footerSeparated = false,
}: DialogProps) {
  const titleId = useId();
  // `open` stays true while busy — toggling it would tear down the focus trap
  // mid-job; only the close callback goes inert.
  const dialogRef = useDialog<HTMLDivElement>(open, busy ? NOOP : onClose);
  useDialogRefocus(dialogRef, refocusKey);
  if (!open) return null;

  return (
    <div
      onPointerDown={busy ? undefined : onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.modal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: MODAL_BACKDROP,
        backdropFilter: MODAL_BLUR,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedById}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          width: WIDTHS[size],
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100dvh - 40px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--bg-sf)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          boxShadow: "0 32px 80px rgba(0,0,0,.7)",
        }}
      >
        <header
          style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
            padding: "18px 14px 14px 20px",
            borderBottom: "1px solid var(--bd)",
          }}
        >
          <div style={{ minWidth: 0 }}>
            {kicker ? (
              <div style={{ marginBottom: 5, color: "var(--t3)", fontSize: 9, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>
                {kicker}
              </div>
            ) : null}
            <div id={titleId} style={{ overflow: "hidden", color: "var(--t1)", fontSize: 15, fontWeight: 800, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {title}
            </div>
            {subtitle ? (
              <div style={{ marginTop: 5, color: "var(--t3)", fontSize: 11.5, lineHeight: 1.5 }}>{subtitle}</div>
            ) : null}
          </div>
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
            {headerAction}
            {closeButton ? (
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                aria-label="Close dialog"
                style={{
                  width: 32,
                  height: 32,
                  padding: 0,
                  border: "1px solid var(--bd)",
                  borderRadius: 2,
                  background: "transparent",
                  color: "var(--t2)",
                  fontFamily: "inherit",
                  fontSize: 17,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.45 : 1,
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        </header>

        {/* minHeight:0 is load-bearing — without it a flex child refuses to
            shrink below its content and the height cap above does nothing. */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 20px", ...bodyStyle }}>
          {children}
        </div>

        {footer ? (
          <footer
            style={{
              flex: "0 0 auto",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "14px 20px 18px",
              borderTop: footerSeparated ? "1px solid var(--bd)" : undefined,
            }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/** Re-anchor focus to [data-autofocus] when `refocusKey` changes and the
 *  previously focused control unmounted with its phase. useDialog's own effect
 *  is keyed on `open` and can't see phase flips inside an open dialog. */
function useDialogRefocus(ref: RefObject<HTMLDivElement | null>, refocusKey: unknown) {
  useEffect(() => {
    if (refocusKey === undefined) return;
    const node = ref.current;
    if (!node) return;
    if (node.contains(document.activeElement)) return;
    node.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [ref, refocusKey]);
}

type DialogButtonVariant = "primary" | "danger" | "ghost";

interface DialogButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: DialogButtonVariant;
  /** Flex share of the footer row. Primary defaults to 2 — the answer earns
   *  more room than the exit — everything else to 1. */
  grow?: number;
}

/** A footer button. Order convention: dismiss first (left), primary last. */
export function DialogButton({ variant = "ghost", grow, disabled, style, ...props }: DialogButtonProps) {
  const base: CSSProperties = {
    flex: grow ?? (variant === "ghost" ? 1 : 2),
    minWidth: 0,
    height: 36,
    padding: "0 14px",
    borderRadius: 2,
    fontFamily: "inherit",
    fontSize: 12,
    cursor: disabled ? "default" : "pointer",
  };
  const skin: CSSProperties =
    variant === "primary"
      ? disabled
        ? { border: 0, background: "var(--bd)", color: "var(--tm)", fontWeight: 800 }
        : { border: 0, background: "var(--ac)", color: "#050505", fontWeight: 800 }
      : variant === "danger"
        ? disabled
          ? { border: 0, background: "var(--bd)", color: "var(--tm)", fontWeight: 700 }
          : { border: 0, background: "#ff5c5c", color: "#fff", fontWeight: 700 }
        : { border: "1px solid var(--bd)", background: "transparent", color: "var(--t2b)", opacity: disabled ? 0.5 : 1 };
  return <button type="button" disabled={disabled} style={{ ...base, ...skin, ...style }} {...props} />;
}
