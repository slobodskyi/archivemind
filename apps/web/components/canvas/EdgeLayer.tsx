import { memo } from "react";
import type { CanvasEdge, CanvasEdgeEndpoint } from "@archivemind/shared";
import { edgeSeed, mkBez, type StickyNote, type TilePos } from "@/lib/layout";

interface EdgeLayerProps {
  /** The open board's edges only — the caller scopes them (ADR 0048). */
  edges: readonly CanvasEdge[];
  /** The filtered render positions (visibleTilePositions output) — an edge can
   *  only land on and draw to what is actually drawn. */
  positions: Record<string, TilePos>;
  /** The open board's notes, for annotation endpoints. */
  notes: readonly StickyNote[];
  selectedEdgeId: string | null;
  onSelect: (id: string) => void;
  /** Hands the live wire's <path> node to the hook, which draws the in-flight
   *  drag onto it imperatively — one setAttribute per pointermove, zero React
   *  renders (the NoteInkLayer rule). */
  setLiveRef: (node: SVGPathElement | null) => void;
}

/** User-drawn connections on the Workspace canvas (ADR 0048). One absolute SVG
 *  in canvas coordinates (the CloudDecor arrangement): svg units == canvas
 *  units, `overflow: visible` means the fixed size is cosmetic only.
 *
 *  An edge stores no geometry — both endpoint positions are read fresh from
 *  wherever they live right now (a tile's override, a note's server x/y), so
 *  wires follow drags for free. An endpoint with no position (label-filtered
 *  tile, collapsed-folder member, deleted object) hides its edge: an edge is a
 *  statement about two visible things.
 *
 *  zIndex 1 — the CloudDecor band, under every tile and note: a wire is
 *  connective tissue and must never occlude a photo. Selection still works
 *  because each edge carries an invisible fat twin path that takes the click. */
function EdgeLayerBase({ edges, positions, notes, selectedEdgeId, onSelect, setLiveRef }: EdgeLayerProps) {
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const centerOf = (point: CanvasEdgeEndpoint): { x: number; y: number } | null => {
    if (point.kind === "asset") {
      const tile = positions[point.id];
      return tile ? { x: tile.cx, y: tile.cy } : null;
    }
    const note = noteById.get(point.id);
    return note ? { x: note.x + note.w / 2, y: note.y + note.h / 2 } : null;
  };

  return (
    <svg
      width={1600}
      height={1100}
      style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none", zIndex: 1 }}
      aria-hidden="true"
    >
      {edges.map((edge) => {
        const a = centerOf(edge.from);
        const b = centerOf(edge.to);
        if (!a || !b) return null;
        const d = mkBez(a.x, a.y, b.x, b.y, edgeSeed(edge.id), 0.18);
        const selected = edge.id === selectedEdgeId;
        return (
          <g key={edge.id}>
            <path
              d={d}
              fill="none"
              stroke={selected ? "var(--ac)" : "color-mix(in srgb, var(--ac) 45%, transparent)"}
              strokeWidth={selected ? 2.5 : 1.5}
              strokeLinecap="round"
            />
            {selected && (
              <>
                <circle cx={a.x} cy={a.y} r={3} fill="var(--ac)" />
                <circle cx={b.x} cy={b.y} r={3} fill="var(--ac)" />
              </>
            )}
            {/* The click target: invisible, fat, and the only pointer-active
                thing in this layer — the visible stroke stays untouchable so
                its width is a design choice, not a hit area. */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: "stroke", cursor: "pointer" }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onSelect(edge.id);
              }}
            />
          </g>
        );
      })}
      {/* The in-flight wire, drawn imperatively by the hook during a drag. */}
      <path
        ref={setLiveRef}
        fill="none"
        stroke="color-mix(in srgb, var(--ac) 60%, transparent)"
        strokeWidth={1.5}
        strokeDasharray="6 5"
        strokeLinecap="round"
      />
    </svg>
  );
}

const EdgeLayer = memo(EdgeLayerBase);
export default EdgeLayer;
