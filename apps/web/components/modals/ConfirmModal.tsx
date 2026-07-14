import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmModal({ open, title, body, confirmLabel, danger, onConfirm, onClose }: ConfirmModalProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: MODAL_BACKDROP,
        backdropFilter: MODAL_BLUR,
        zIndex: Z.modal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 380, background: "var(--bg-sf)", border: "1px solid var(--bdh)", borderRadius: 2, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}
      >
        <div style={{ padding: "20px 20px 16px" }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", marginBottom: 8 }}>{title}</div>
          <div style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.5 }}>{body}</div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "0 20px 20px" }}>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              height: 34,
              background: danger ? "#ff5c5c" : "var(--ac)",
              color: danger ? "#fff" : "#050505",
              border: 0,
              borderRadius: 2,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: ".04em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, height: 34, background: "transparent", color: "var(--t3)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
