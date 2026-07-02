import type { ProjectKey } from "@/types";
import { PROJECTS_META } from "@/lib/mock-data";
import { AddIcon } from "@/components/icons/icons";

const PROJECT_KEYS: ProjectKey[] = ["frontline", "travel", "client"];

interface AddToProjectPopoverProps {
  open: boolean;
  onClose: () => void;
  onSelect: (key: ProjectKey) => void;
  onCreateNew: () => void;
}

export default function AddToProjectPopover({ open, onClose, onSelect, onCreateNew }: AddToProjectPopoverProps) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 63 }} />
      <div
        style={{
          position: "absolute",
          bottom: 74,
          left: "50%",
          transform: "translateX(-50%)",
          width: 260,
          background: "rgba(18,18,18,.97)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          backdropFilter: "blur(20px)",
          boxShadow: "0 20px 60px rgba(0,0,0,.7)",
          zIndex: 64,
          padding: 6,
        }}
      >
        <div style={{ padding: "6px 8px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)" }}>
          Add to project
        </div>
        {PROJECT_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => onSelect(k)}
            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", background: "transparent", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit" }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", background: PROJECTS_META[k].color }} />
            <span style={{ flex: 1, fontSize: 13, color: "var(--t1)", textAlign: "left" }}>{PROJECTS_META[k].label}</span>
          </button>
        ))}
        <div style={{ height: 1, background: "var(--bd)", margin: "4px 0" }} />
        <button
          onClick={onCreateNew}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", background: "transparent", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit", color: "var(--ac)", fontSize: 13 }}
        >
          <AddIcon width={13} height={13} strokeWidth={1.6} />
          New project
        </button>
      </div>
    </>
  );
}
