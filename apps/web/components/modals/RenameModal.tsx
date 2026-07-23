import { useId, useState } from "react";
import { useDialog } from "@/hooks/useDialog";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";

interface RenameModalProps {
  open: boolean;
  initialName: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

/** Pass a `key` (e.g. the target project's id) from the caller so this
 *  remounts with a fresh `name` state whenever the rename target changes,
 *  instead of syncing initialName via an effect. */
export default function RenameModal({ open, initialName, onSave, onClose }: RenameModalProps) {
  const [name, setName] = useState(initialName);
  const dialogRef = useDialog<HTMLDivElement>(open, onClose);
  const titleId = useId();

  if (!open) return null;
  const trimmed = name.trim();

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 380, background: "var(--bg-sf)", border: "1px solid var(--bdh)", borderRadius: 2, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}
      >
        <div style={{ padding: "20px 20px 16px" }}>
          <div id={titleId} style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", marginBottom: 12 }}>Rename project</div>
          <input
            // Initial focus is handled by useDialog (which first captures the
            // trigger to restore focus to it on close) — autoFocus here would
            // pre-empt that capture and lose the return target.
            data-autofocus=""
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmed) onSave(trimmed);
            }}
            style={{ width: "100%", padding: "10px 12px", background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 2, color: "var(--t1)", fontSize: 13, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, padding: "0 20px 20px" }}>
          <button
            onClick={() => trimmed && onSave(trimmed)}
            disabled={!trimmed}
            style={{ flex: 1, height: 34, background: trimmed ? "var(--ac)" : "var(--bg-el)", color: trimmed ? "#050505" : "var(--tm)", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, letterSpacing: ".04em", cursor: trimmed ? "pointer" : "default", fontFamily: "inherit" }}
          >
            Save
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, height: 34, background: "transparent", color: "var(--t2b)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
