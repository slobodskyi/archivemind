"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetLabel, Board, LabelNames } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import { POPOVER_SURFACE } from "@/lib/ui";
import { AddIcon, ChevronDownIcon } from "@/components/icons/icons";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import { BOARD_CHIP_ATTR } from "@/lib/board-drop";

interface BoardBrowserProps {
  boards: Board[];
  activeBoardId: string | null;
  counts: Record<string, number>;
  /** The workspace's seven colour names — a chip's picker shows the same words
   *  the photo and note pickers do, because it is the same vocabulary. */
  labelNames: LabelNames;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onRecolor: (id: string, color: AssetLabel) => void;
  /** Asks first — the caller opens the confirmation, this only requests it. */
  onDelete: (id: string) => void;
  /** The chip a canvas drag is currently over, if any (ADR 0044). The drag is
   *  the canvas's own pointer drag, not HTML5 DnD, so the header is told which
   *  chip is armed rather than receiving a `dragover`. */
  dropTargetId?: string | null;
}

/** Fallback shown before the first width measurement lands (avoids a flash of
 *  either every chip or none while the layout effect hasn't run yet). */
const INITIAL_VISIBLE_CAP = 4;
/** The ＋ button (30px) plus its gap to the last chip/overflow button. */
const CREATE_BTN_W = 34;
/** Conservative estimate for the "+N ▾" button — the count is at most two
 *  digits in practice, so this over-reserves slightly rather than clipping. */
const OVERFLOW_BTN_W = 58;
const CHIP_GAP = 4;

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
export default function BoardBrowser({ boards, activeBoardId, counts, labelNames, onSelect, onCreate, onRename, onRecolor, onDelete, dropTargetId = null }: BoardBrowserProps) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  /** The chip whose colour picker is open, and where to draw it. Local, like the
   *  rename draft — chrome state, nothing outside this row needs it.
   *
   *  The coordinates are captured from the chip on open and the popover is
   *  `position: fixed`, because the header clips its breadcrumb (`overflow:
   *  hidden`, so a long chip row cannot run under SHARE) and an absolutely
   *  positioned popover inside a chip would be clipped with it. A fixed element
   *  is laid out against the viewport, so it escapes — no ancestor here creates
   *  a containing block for it. */
  const [colorFor, setColorFor] = useState<{ id: string; x: number; y: number } | null>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Width-aware overflow: how many chips actually fit is a function of the
  // room the header has left (which now flexes all the way to undo/redo,
  // not a fixed cap), not a hardcoded count. `rowRef` is the flex item that
  // fills that remaining room; `measureContainerRef` holds an offscreen copy
  // of every chip so trimming doesn't depend on the visible row's own
  // (still-settling) size. Widths come from a DOM query in the effect below
  // rather than per-chip refs, since a ref written from inside the render
  // tree (even indirectly) trips the ref-during-render lint rule.
  const rowRef = useRef<HTMLDivElement>(null);
  const measureContainerRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_CAP);

  const openColorPicker = (target: HTMLElement, id: string) => {
    const rect = (target.closest(`[${BOARD_CHIP_ATTR}]`) ?? target).getBoundingClientRect();
    setColorFor({ id, x: rect.left, y: rect.bottom + 6 });
  };

  useEffect(() => {
    if (!overflowOpen) return;
    const close = (e: PointerEvent) => {
      if (!overflowRef.current?.contains(e.target as Node)) setOverflowOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [overflowOpen]);

  // Same click-away as the overflow menu, plus Escape: the picker sits over the
  // canvas, so a press meant for a tile must not also leave it hanging open.
  useEffect(() => {
    if (!colorFor) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setColorFor(null);
        return;
      }
      if (!(e.target as HTMLElement)?.closest("[data-board-color]")) setColorFor(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [colorFor]);

  useLayoutEffect(() => {
    const recompute = () => {
      const available = rowRef.current?.clientWidth;
      if (available == null) return;
      const chips = measureContainerRef.current?.querySelectorAll<HTMLDivElement>(`[${BOARD_CHIP_ATTR}]`);
      const widths = boards.map((_, i) => chips?.[i]?.offsetWidth ?? 0);
      const totalWidth = widths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP : 0), 0);
      // Everything fits with no overflow button needed at all.
      if (totalWidth + CHIP_GAP + CREATE_BTN_W <= available) {
        setVisibleCount(boards.length);
        return;
      }
      // Otherwise trim from the end, reserving room for the "+N ▾" button
      // that will now definitely be shown.
      let used = CREATE_BTN_W + CHIP_GAP + OVERFLOW_BTN_W;
      let count = 0;
      for (const w of widths) {
        const next = used + (count > 0 ? CHIP_GAP : 0) + w;
        if (count > 0 && next > available) break;
        used = next;
        count++;
      }
      setVisibleCount(count);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (rowRef.current) ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, [boards, labelNames]);

  const visible = boards.slice(0, visibleCount);
  const overflow = boards.slice(visibleCount);

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
          // A flex item defaults to min-width:auto, i.e. "never narrower than my
          // text" — so without this the row pushes past the header's cap instead
          // of the names ellipsizing.
          minWidth: 0,
        }}
        onClick={() => onSelect(b.id)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditingId(b.id);
          setDraft(b.name);
        }}
        // Right-click is where a colour lives everywhere else in the app (a
        // photo's swatch row is the top of its context menu — ADR 0040), so it
        // is where a workspace's is too.
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          openColorPicker(e.currentTarget, b.id);
        }}
        title={active ? `${b.name} — double-click to rename, right-click for colour` : b.name}
      >
        {/* The dot IS the colour, so clicking it opens the picker — the
            discoverable half of the gesture, since nobody guesses right-click.
            It does not select the workspace: you are pointing at its colour. */}
        <button
          type="button"
          data-board-color=""
          aria-label={`Colour of ${b.name}`}
          title={`${labelNames[b.color]} — click to change`}
          onClick={(e) => {
            e.stopPropagation();
            if (colorFor?.id === b.id) setColorFor(null);
            else openColorPicker(e.currentTarget, b.id);
          }}
          style={{
            flex: "0 0 auto",
            width: 14,
            height: 14,
            padding: 0,
            border: 0,
            borderRadius: "50%",
            background: LABEL_COLORS[b.color],
            boxShadow: `0 0 8px ${LABEL_COLORS[b.color]}66`,
            cursor: "pointer",
          }}
        />
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
    <div ref={rowRef} style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, flex: "1 1 auto", overflow: "hidden" }}>
      {/* No "All files" chip: the project name to the left of this row says the
          same thing, and clicking it is what leaves a Workspace now (ADR 0044
          amended). Two controls for one scope is one control too many. */}
      {visible.map(chip)}

      {/* Offscreen copy of every chip, unclamped by `visible` — its rendered
          widths are what `recompute` above trims against. Not `display: none`
          (which reports 0 for offsetWidth); `visibility: hidden` still lays
          out. */}
      <div ref={measureContainerRef} aria-hidden="true" style={{ position: "absolute", top: -9999, left: -9999, visibility: "hidden", pointerEvents: "none", display: "flex", gap: CHIP_GAP }}>
        {boards.map(chip)}
      </div>

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
            <div style={{ ...POPOVER_SURFACE, position: "absolute", top: "100%", left: 0, marginTop: 4, minWidth: 160, padding: 4 }}>
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

      {/* The workspace's colour, picked from the same seven-swatch row a photo's
          label and a sticky note's paper use (ADR 0040) — one object, one
          gesture, learned once. `clearable={false}`, like the note: a workspace
          without a colour is not a state, and the chip has a dot to draw. */}
      {colorFor && (
        <div
          data-board-color=""
          style={{ ...POPOVER_SURFACE, position: "fixed", left: colorFor.x, top: colorFor.y, padding: 3 }}
        >
          <LabelSwatchRow
            names={labelNames}
            current={boards.find((b) => b.id === colorFor.id)?.color ?? null}
            clearable={false}
            onPick={(color) => {
              if (color) onRecolor(colorFor.id, color);
              setColorFor(null);
            }}
          />
        </div>
      )}
    </div>
  );
}
