import { CheckIcon } from "@/components/icons/icons";

interface ToastProps {
  show: boolean;
  text: string;
}

export default function Toast({ show, text }: ToastProps) {
  if (!show) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 70,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 9,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 999,
        padding: "9px 16px",
        boxShadow: "0 12px 40px rgba(0,0,0,.6)",
        zIndex: 60,
        animation: "amFadeScale .2s ease both",
      }}
    >
      <span
        style={{
          display: "flex",
          width: 18,
          height: 18,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 999,
          background: "var(--accent-green)",
        }}
      >
        <CheckIcon width={11} height={11} strokeWidth={2.6} />
      </span>
      <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{text}</span>
    </div>
  );
}
