import { useState } from "react";
import Dialog, { DialogButton } from "@/components/modals/Dialog";

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
  const trimmed = name.trim();

  return (
    <Dialog
      open={open}
      size="s"
      title="Rename project"
      closeButton={false}
      onClose={onClose}
      footer={
        <>
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          <DialogButton variant="primary" disabled={!trimmed} onClick={() => trimmed && onSave(trimmed)}>
            Save
          </DialogButton>
        </>
      }
    >
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
    </Dialog>
  );
}
