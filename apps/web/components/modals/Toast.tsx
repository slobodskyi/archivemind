import { Z } from "@/lib/ui";
import { CheckIcon } from "@/components/icons/icons";

interface ToastProps {
  show: boolean;
  text: string;
  /** Optional action button (ADR 0033 — the delete Undo). The caller owns
   *  what happens next. */
  actionLabel?: string;
  onAction?: () => void;
  /** "default" = the attention toast under the header (confirmations, errors).
   *  "quiet" = a low-key bottom-left snackbar chip for routine actions that
   *  repeat during normal work (delete → Undo): the only free corner — the
   *  toolbar owns the left middle, the action bar the bottom center, the
   *  minimap the bottom right — and the spot the Google-style undo pattern
   *  trained everyone to glance at. */
  variant?: "default" | "quiet";
}

export default function Toast({ show, text, actionLabel, onAction, variant = "default" }: ToastProps) {
  if (!show) return null;

  if (variant === "quiet") {
    return (
      <div
        style={{
          position: "absolute",
          left: 20,
          bottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "rgba(16,16,16,.92)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          padding: "7px 12px",
          boxShadow: "0 6px 20px rgba(0,0,0,.35)",
          backdropFilter: "blur(16px)",
          zIndex: Z.toast,
          animation: "amFadeScale .2s ease both",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--t2)" }}>{text}</span>
        {actionLabel && onAction && (
          <button
            onClick={onAction}
            style={{
              padding: 0,
              background: "transparent",
              border: 0,
              color: "var(--ac)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: ".04em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-el)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        padding: "8px 14px",
        boxShadow: "0 12px 40px rgba(0,0,0,.6)",
        zIndex: Z.toast,
        animation: "amFadeScale .2s ease both",
      }}
    >
      <span
        style={{
          display: "flex",
          width: 16,
          height: 16,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 2,
          background: "var(--ac)",
        }}
      >
        <CheckIcon />
      </span>
      <span style={{ fontSize: 13, color: "var(--t1)" }}>{text}</span>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            marginLeft: 4,
            height: 24,
            padding: "0 10px",
            background: "transparent",
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            color: "var(--ac)",
            fontSize: 11.5,
            fontWeight: 700,
            letterSpacing: ".04em",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
