"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AssetLabel, Board, LabelNames } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import { POPOVER_SURFACE } from "@/lib/ui";
import { AddIcon, ChevronRightIcon } from "@/components/icons/icons";
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

/** How close to an edge the pointer has to be, mid-drag, for the rail to start
 *  scrolling itself, and how fast it goes. Photos are dropped onto chips (ADR
 *  0044) and a held pointer cannot also turn a wheel, so without this a chip
 *  parked off-screen is not a reachable target. */
const DRAG_EDGE = 48;
const DRAG_SPEED = 14;

/** Width of the soft edge that says "there is more this way". Cheaper than a
 *  scrollbar and it costs no room in a 52px header. */
const FADE = 18;

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
  const chipRowRef = useRef<HTMLDivElement>(null);
  /** What the rail currently hides. `right` drives the counter, the two flags
   *  drive the edge fades — a fade is drawn only on a side that is actually cut
   *  off, so a rail with room to spare has hard edges like any other row. */
  const [cut, setCut] = useState({ right: 0, atStart: true, atEnd: true });

  /** Read what is currently out of view. Every chip is always rendered and
   *  always reachable — the rail scrolls rather than folding, so nothing is
   *  hidden from the pointer, from `elementFromPoint` (which is how a photo
   *  finds a chip to be dropped on) or from a re-measure.
   *
   *  Runs on scroll and on resize. `scrollLeft` can be fractional at fractional
   *  zoom, hence the 1px slack on both ends — without it a rail scrolled fully
   *  right keeps drawing a fade over a chip that is entirely visible. */
  useLayoutEffect(() => {
    const row = chipRowRef.current;
    if (!row) return;

    const read = () => {
      const left = row.scrollLeft;
      const viewRight = left + row.clientWidth;
      const chips = [...row.children] as HTMLElement[];
      setCut({
        right: chips.filter((el) => el.offsetLeft + el.offsetWidth > viewRight + 1).length,
        atStart: left <= 1,
        atEnd: left >= row.scrollWidth - row.clientWidth - 1,
      });
    };

    read();
    row.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(row);
    return () => {
      row.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [boards, counts, activeBoardId]);

  /** A wheel mouse has no horizontal axis, and this rail has no vertical one, so
   *  without translating the two a desktop user without a trackpad simply cannot
   *  reach the far chips. Native and non-passive because it has to be able to
   *  swallow the event; `deltaX` is left alone so a trackpad's own horizontal
   *  swipe keeps working. */
  useEffect(() => {
    const row = chipRowRef.current;
    if (!row) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || e.deltaY === 0) return;
      if (row.scrollWidth <= row.clientWidth) return;
      e.preventDefault();
      row.scrollLeft += e.deltaY;
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, []);

  /** Auto-scroll while something is being dragged over an edge. The canvas drives
   *  its own pointer drags, so a held button plus a pointer in the edge zone is
   *  the whole signal — no new state has to be threaded through `useWorkspace`
   *  for the header to cooperate with a drag that started on the canvas.
   *
   *  The rAF loop only exists while the pointer is actually in a zone, and the
   *  move listener only while a button is down, so an idle header costs nothing. */
  useEffect(() => {
    let raf = 0;
    let dir = 0;

    const step = () => {
      const row = chipRowRef.current;
      if (!row || dir === 0) return void (raf = 0);
      row.scrollLeft += dir * DRAG_SPEED;
      raf = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      const row = chipRowRef.current;
      if (!row || e.buttons === 0) return;
      const r = row.getBoundingClientRect();
      const inRow = e.clientY >= r.top && e.clientY <= r.bottom;
      dir =
        !inRow || e.clientX < r.left - DRAG_EDGE || e.clientX > r.right + DRAG_EDGE
          ? 0
          : e.clientX < r.left + DRAG_EDGE
            ? -1
            : e.clientX > r.right - DRAG_EDGE
              ? 1
              : 0;
      if (dir !== 0 && raf === 0) raf = requestAnimationFrame(step);
    };
    const stop = () => {
      dir = 0;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const onDown = () => window.addEventListener("pointermove", onMove);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      stop();
    };

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onMove);
      stop();
    };
  }, []);

  /** Opening a workspace whose chip is scrolled out of sight would leave the rail
   *  showing no selection at all. `inline: nearest` scrolls the minimum needed
   *  and `block: nearest` keeps it from scrolling an ancestor vertically. */
  useEffect(() => {
    if (!activeBoardId) return;
    chipRowRef.current
      ?.querySelector(`[${BOARD_CHIP_ATTR}="${CSS.escape(activeBoardId)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activeBoardId]);

  const openColorPicker = (target: HTMLElement, id: string) => {
    const rect = (target.closest(`[${BOARD_CHIP_ATTR}]`) ?? target).getBoundingClientRect();
    setColorFor({ id, x: rect.left, y: rect.bottom + 6 });
  };

  // Click-away for the colour picker, plus Escape: the picker sits over the
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

  const commitRename = () => {
    if (editingId && draft.trim()) onRename(editingId, draft.trim());
    setEditingId(null);
  };

  const fadeMask = `linear-gradient(to right, ${
    cut.atStart ? "#000 0" : `transparent 0, #000 ${FADE}px`
  }, ${cut.atEnd ? "#000 100%" : `#000 calc(100% - ${FADE}px), transparent 100%`})`;

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
          // A chip holds its width and scrolls out of the row; it never shrinks.
          // Letting them shrink squeezed every name toward nothing at once and
          // left a line of bare coloured dots. `maxWidth` below still ellipsizes
          // a genuinely long name.
          flex: "0 0 auto",
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
        {/* Bracketed so the count reads as a count, not as part of the name. */}
        <span style={{ fontSize: 11, color: "var(--t3)" }}>[{counts[b.id] ?? b.assetIds.length}]</span>
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        minWidth: 0,
        flex: "1 1 auto",
      }}
    >
      {/* No "All files" chip: the project name to the left of this row says the
          same thing, and clicking it is what leaves a Workspace now (ADR 0044
          amended). Two controls for one scope is one control too many.

          The rail SCROLLS rather than folding chips away. Folding meant a
          workspace you could see the name of yesterday was simply absent today,
          and the chips past the fold were `inert` — not clickable, and not
          findable by `elementFromPoint`, so a photo could not be dropped on them
          either. Scrolling keeps every chip a real, reachable object; what
          changes is only how much of the row you are looking at. */}
      <div
        ref={chipRowRef}
        className="am-hdr-chiprow"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          minWidth: 0,
          flex: "1 1 auto",
          overflowX: "auto",
          overflowY: "hidden",
          // No visible scrollbar: a 52px header has no room for one, and the
          // fades plus the counter already say there is more. The rail is over a
          // canvas that claims every gesture with `touch-action: none`, so this
          // is what hands the horizontal drag back to the row.
          scrollbarWidth: "none",
          touchAction: "pan-x",
          overscrollBehaviorX: "contain",
          // Fade only the side that is actually cut off — a rail with room to
          // spare gets hard edges, so the fade always MEANS something.
          maskImage: cut.atStart && cut.atEnd ? undefined : fadeMask,
          WebkitMaskImage: cut.atStart && cut.atEnd ? undefined : fadeMask,
        }}
      >
        {boards.map(chip)}
      </div>

      {/* Not a menu any more — a readout. It says how many chips are off to the
          right and scrolls them into view when clicked. The dropdown it replaced
          was a second, competing way to reach a workspace, and it listed exactly
          the chips the rail had chosen to hide; with a scroller there is nothing
          to hide and nothing to list. */}
      {cut.right > 0 && (
        <button
          onClick={() => chipRowRef.current?.scrollBy({ left: chipRowRef.current.clientWidth * 0.8, behavior: "smooth" })}
          aria-label={`${cut.right} more to the right — scroll`}
          title={`${cut.right} more — click to scroll`}
          style={{ display: "flex", alignItems: "center", gap: 3, height: 30, padding: "0 8px", border: 0, borderRadius: 2, background: "transparent", color: "var(--t3)", fontFamily: "inherit", fontSize: 12, cursor: "pointer", flex: "0 0 auto" }}
        >
          +{cut.right}
          <ChevronRightIcon width={10} height={10} stroke="currentColor" />
        </button>
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
