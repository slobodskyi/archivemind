import { useId } from "react";
import Dialog, { DialogButton } from "@/components/modals/Dialog";

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
  const bodyId = useId();
  return (
    <Dialog
      open={open}
      size="s"
      title={title}
      closeButton={false}
      describedById={bodyId}
      onClose={onClose}
      footer={
        <>
          <DialogButton
            onClick={onClose}
            // For an irreversible/danger action, focus lands on Cancel, not Confirm.
            data-autofocus={danger ? "" : undefined}
          >
            Cancel
          </DialogButton>
          <DialogButton
            variant={danger ? "danger" : "primary"}
            onClick={onConfirm}
            // A routine confirm starts on the answer; a destructive one starts
            // on the way out (the Cancel above takes data-autofocus instead).
            data-autofocus={danger ? undefined : ""}
          >
            {confirmLabel}
          </DialogButton>
        </>
      }
    >
      <div id={bodyId} style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.5 }}>{body}</div>
    </Dialog>
  );
}
