import type { ProjectKey } from "@/types";
import type { ProjectListItem } from "@/hooks/useWorkspace";
import { Z } from "@/lib/ui";
import { CheckIcon } from "@/components/icons/icons";

interface ProjectDropdownProps {
  open: boolean;
  list: ProjectListItem[];
  onClose: () => void;
  onSelect: (key: ProjectKey) => void;
}

export default function ProjectDropdown({ open, list, onClose, onSelect }: ProjectDropdownProps) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: Z.menuBackdrop }} />
      <div
        style={{
          position: "absolute",
          top: 58,
          left: 14,
          width: 290,
          background: "rgba(18,18,18,.97)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          backdropFilter: "blur(20px)",
          boxShadow: "0 20px 60px rgba(0,0,0,.7)",
          zIndex: Z.menu,
          padding: 6,
        }}
      >
        <div style={{ padding: "5px 10px 4px", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)" }}>
          Projects
        </div>
        {list.map((it) => (
          <button
            key={it.key}
            onClick={() => onSelect(it.key)}
            className="am-mi"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              width: "100%",
              padding: "8px 10px",
              background: it.active ? "var(--bg-el)" : undefined,
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
      </div>
    </>
  );
}
