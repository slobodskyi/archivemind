import type { ProjectKey } from "@/types";
import type { ProjectListItem } from "@/hooks/useWorkspace";
import { CheckIcon, AddIcon } from "@/components/icons/icons";

interface ProjectDropdownProps {
  open: boolean;
  isAll: boolean;
  list: ProjectListItem[];
  onClose: () => void;
  onSelectAll: () => void;
  onSelect: (key: ProjectKey) => void;
}

function FolderIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

export default function ProjectDropdown({ open, isAll, list, onClose, onSelectAll, onSelect }: ProjectDropdownProps) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 48 }} />
      <div
        style={{
          position: "absolute",
          top: 58,
          left: 66,
          width: 290,
          background: "rgba(18,18,18,.97)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          backdropFilter: "blur(20px)",
          boxShadow: "0 20px 60px rgba(0,0,0,.7)",
          zIndex: 49,
          padding: 6,
        }}
      >
        <button
          onClick={onSelectAll}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 10px", background: "transparent", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit" }}
        >
          <span style={{ display: "flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 2, background: "var(--bg-el)", color: "var(--t3)" }}>
            <FolderIcon />
          </span>
          <span style={{ flex: 1, fontSize: 13, color: "var(--t1)", textAlign: "left" }}>All my files</span>
          {isAll && <CheckIcon width={13} height={13} stroke="var(--ac)" strokeWidth={2.4} />}
        </button>
        <div style={{ height: 1, background: "var(--bd)", margin: "4px 0" }} />
        <div style={{ padding: "5px 10px 4px", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)" }}>
          Archives
        </div>
        {list.map((it) => (
          <button
            key={it.key}
            onClick={() => onSelect(it.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              padding: "8px 10px",
              background: it.active ? "var(--bg-el)" : "transparent",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", background: it.color }} />
            <span style={{ flex: 1, fontSize: 13, color: "var(--t1)", textAlign: "left" }}>{it.label}</span>
            <span style={{ fontSize: 10.5, color: "var(--tm)" }}>{it.count}</span>
            {it.active && <CheckIcon width={13} height={13} stroke="var(--ac)" strokeWidth={2.4} />}
          </button>
        ))}
        <div style={{ height: 1, background: "var(--bd)", margin: "4px 0" }} />
        <button
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", background: "transparent", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit", color: "var(--t2)", fontSize: 13 }}
        >
          <AddIcon width={13} height={13} strokeWidth={1.6} />
          New archive
        </button>
      </div>
    </>
  );
}
