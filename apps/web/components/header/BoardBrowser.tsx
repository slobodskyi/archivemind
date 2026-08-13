"use client";

import { useEffect, useRef, useState } from "react";
import type { Board } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import { AddIcon, ChevronDownIcon } from "@/components/icons/icons";
import { BOARD_CHIP_ATTR } from "@/lib/board-drop";

interface BoardBrowserProps {
  boards: Board[];
  activeBoardId: string | null;
  counts: Record<string, number>;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  /** Asks first — the caller opens the confirmation, this only requests it. */
  onDelete: (id: string) => void;
  /** The chip a canvas drag is currently over, if any (ADR 0044). The drag is
   *  the canvas's own pointer drag, not HTML5 DnD, so the header is told which
   *  chip is armed rather than receiving a `dragover`. */
  dropTargetId?: string | null;
}

/** How many board chips show inline before the rest fold into a "+N ▾" menu. */
const VISIBLE_CAP = 4;

/** The Workspace browser in the header (ADR 0044): "All files" (the sorting
 *  views over the whole project) then a chip per workspace — colour dot · name ·
 *  count — a ＋ to create one, and a "+N ▾" overflow. Selecting a chip opens that
 *  workspace's working canvas; "All files" returns to browsing the whole project.
 *
 *  Deleting is a two-step affair here, and deliberately: the × sits on the chip
 *  you click to OPEN a workspace, so it asks (the caller owns the confirmation)
 *  and it moves the workspace to Trash rather than removing it. The undo lives
 *  on that delete's own toast and in the Trash panel — deliberately NOT as a
 *  second ↺ in the header, which read as a broken duplicate of the canvas
 *  undo sitting a few hundred pixels away. */
export default function BoardBrowser({ boards, activeBoardId, counts, onSelect, onCreate, onRename, onDelete, dropTargetId = null }: BoardBrowserProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const close = (e: PointerEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [overflowOpen]);

  const visible = boards.slice(0, VISIBLE_CAP);
  const overflow = boards.slice(VISIBLE_CAP);

  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  const chip = (b: Board) => {
    const active = b.id === activeBoardId;
    const armed = b.id === dropTargetId;
    return (
      <div
        key={b.id}
        {...{ [BOARD_CHIP_ATTR]: b.id }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 30,
          padding: "0 11px",
          borderRadius: 2,
          // Armed beats active: while something is being dragged over it, the
          // chip has to read as a target, not as the workspace you are in.
          border: armed
            ? "1px solid var(--ac)"
            : active
              ? "1px solid var(--bdh)"
              : "1px solid transparent",
          background: armed
            ? "color-mix(in srgb,var(--ac) 16%,transparent)"
            : active
              ? "var(--bg-el)"
              : "transparent",
          cursor: "pointer",
          maxWidth: 200,
        }}
        onClick={() => onSelect(b.id)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditingId(b.id);
          setDraft(b.name);
        }}
        title={active ? `${b.name} — double-click to rename` : b.name}
      >
        <span style={{ flex: "0 0 auto", width: 14, height: 14, borderRadius: "50%", background: LABEL_COLORS[b.color], boxShadow: `0 0 8px ${LABEL_COLORS[b.color]}66` }} />
        {editingId === b.id ? (
          <input
            autoFocus
            value={draft}
            maxLength={40}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditingId(null);
            }}
            style={{ width: 96, height: 20, background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 2, color: "var(--t1)", fontFamily: "inherit", fontSize: 12, padding: "0 5px", outline: "none" }}
          />
        ) : (
          <span style={{ fontSize: 12.5, color: active ? "var(--t1)" : "var(--t2)", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {b.name}
          </span>
        )}
        <span style={{ fontSize: 11, color: "var(--t3)" }}>{counts[b.id] ?? b.assetIds.length}</span>
        {active && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(b.id);
            }}
            aria-label="Move workspace to Trash"
            title="Move workspace to Trash"
            style={{ display: "flex", alignItems: "center", width: 14, height: 14, border: 0, borderRadius: 2, background: "transparent", color: "var(--t3)", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      {/* All files — the whole project in the sorting views. */}
      <button
        onClick={() => onSelect(null)}
        // Carries the attribute with an EMPTY value so a drag passing over it
        // disarms rather than leaving the previous chip lit — see `boardChipAt`.
        {...{ [BOARD_CHIP_ATTR]: "" }}
        style={{
          display: "flex",
          alignItems: "center",
          height: 30,
          padding: "0 11px",
          borderRadius: 2,
          border: activeBoardId === null ? "1px solid var(--bdh)" : "1px solid transparent",
          background: activeBoardId === null ? "var(--bg-el)" : "transparent",
          color: activeBoardId === null ? "var(--t1)" : "var(--t2)",
          fontFamily: "inherit",
          fontSize: 12.5,
          letterSpacing: "0.02em",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
        title="All files — browse the whole project"
      >
        All files
      </button>

      {visible.map(chip)}

      {overflow.length > 0 && (
        <div ref={overflowRef} style={{ position: "relative" }}>
          <button
            onClick={() => setOverflowOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 3, height: 30, padding: "0 8px", border: 0, borderRadius: 2, background: "transparent", color: "var(--t3)", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}
            title={`${overflow.length} more`}
          >
            +{overflow.length}
            <ChevronDownIcon width={10} height={10} stroke="currentColor" />
          </button>
          {overflowOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, minWidth: 160, padding: 4, background: "rgba(18,18,18,.97)", border: "1px solid var(--bdh)", borderRadius: 2, backdropFilter: "blur(20px)", boxShadow: "0 20px 60px rgba(0,0,0,.7)", zIndex: 50 }}>
              {overflow.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    onSelect(b.id);
                    setOverflowOpen(false);
                  }}
                  className="am-mi"
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", height: 30, padding: "0 8px", border: 0, borderRadius: 2, background: "transparent", color: "var(--t1)", fontFamily: "inherit", fontSize: 12.5, cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ width: 11, height: 11, borderRadius: "50%", background: LABEL_COLORS[b.color], flex: "0 0 auto" }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                  <span style={{ fontSize: 11, color: "var(--t3)" }}>{counts[b.id] ?? b.assetIds.length}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onCreate}
        aria-label="New workspace"
        title="New workspace"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, border: "1px dashed var(--bdh)", borderRadius: "50%", background: "transparent", color: "var(--t2)", cursor: "pointer", flex: "0 0 auto" }}
      >
        <AddIcon width={13} height={13} />
      </button>

    </div>
  );
}
