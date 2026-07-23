import { Z } from "@/lib/ui";
import { CheckIcon } from "@/components/icons/icons";

interface ToastProps {
  show: boolean;
  text: string;
  /** Optional action button (ADR 0033 — the delete Undo). Rendered inline so
   *  the toast stays a single quiet line; the caller owns what happens next. */
  actionLabel?: string;
  onAction?: () => void;
}

export default function Toast({ show, text, actionLabel, onAction }: ToastProps) {
  if (!show) return null;
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
