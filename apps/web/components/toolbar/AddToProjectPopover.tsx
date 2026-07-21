import type { CSSProperties } from "react";
import { Z } from "@/lib/ui";
import { AddIcon, FrameToolIcon } from "@/components/icons/icons";

export interface AddToProjectListItem {
  key: string;
  label: string;
  color: string;
}

export interface AddToArtboardListItem {
  key: string;
  label: string;
}

interface AddToProjectPopoverProps {
  open: boolean;
  list: AddToProjectListItem[];
  onClose: () => void;
  onSelect: (key: string) => void;
  onCreateNew: () => void;
  /** Artboards (frames) in the current project — the selection can be added to
   *  any existing one, or wrapped in a new one. Omit/empty to hide the section. */
  artboards?: AddToArtboardListItem[];
  onSelectArtboard?: (key: string) => void;
  onCreateArtboard?: () => void;
  /** Overrides the default toolbar-anchored position (left:76,bottom:20) — used when this popover is nested inside another panel, e.g. the source browser sidebar. */
  positionStyle?: CSSProperties;
}

export default function AddToProjectPopover({
  open,
  list,
  onClose,
  onSelect,
  onCreateNew,
  artboards,
  onSelectArtboard,
  onCreateArtboard,
  positionStyle,
}: AddToProjectPopoverProps) {
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: Z.menuBackdrop }} />
      <div
        style={{
          position: "absolute",
          left: 76,
          bottom: 20,
          width: 260,
          background: "rgba(18,18,18,.97)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          backdropFilter: "blur(20px)",
          boxShadow: "0 20px 60px rgba(0,0,0,.7)",
          zIndex: Z.menu,
          padding: 6,
          ...positionStyle,
        }}
      >
        <div style={{ padding: "6px 8px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)" }}>
          Add to project
        </div>
        {list.map((it) => (
          <button
            key={it.key}
            onClick={() => onSelect(it.key)}
            className="am-mi"
            style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit" }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 999, flex: "0 0 auto", background: it.color }} />
            <span style={{ flex: 1, fontSize: 13, color: "var(--t1)", textAlign: "left" }}>{it.label}</span>
          </button>
        ))}
        <div style={{ height: 1, background: "var(--bd)", margin: "4px 0" }} />
        <button
          onClick={onCreateNew}
          className="am-mi"
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit", color: "var(--ac)", fontSize: 13 }}
        >
          <AddIcon width={13} height={13} strokeWidth={1.6} />
          New project
        </button>

        {onCreateArtboard && (
          <>
            <div style={{ height: 1, background: "var(--bd)", margin: "4px 0" }} />
            <div style={{ padding: "6px 8px 8px", fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)" }}>
              Add to artboard
            </div>
            {(artboards ?? []).map((it) => (
              <button
                key={it.key}
                onClick={() => onSelectArtboard?.(it.key)}
                className="am-mi"
                style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 10px", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit" }}
              >
                <span style={{ display: "flex", flex: "0 0 auto", color: "var(--t3)" }}>
                  <FrameToolIcon width={13} height={13} />
                </span>
                <span style={{ flex: 1, fontSize: 13, color: "var(--t1)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
              </button>
            ))}
            <button
              onClick={onCreateArtboard}
              className="am-mi"
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "9px 10px", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit", color: "var(--ac)", fontSize: 13 }}
            >
              <AddIcon width={13} height={13} strokeWidth={1.6} />
              New artboard
            </button>
          </>
        )}
      </div>
    </>
  );
}
