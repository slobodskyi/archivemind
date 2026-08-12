import { useRef, useState } from "react";
import type { AssetLabel, InkPoint, NoteStroke } from "@archivemind/shared";
import { INK_MAX_POINTS } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import { bandWidth, distanceToStroke, pressureSegments, simplifyStroke, strokePath } from "@/lib/ink";

interface NoteInkLayerProps {
  strokes: NoteStroke[];
  /** Pencil or eraser mode is on — the layer captures pointers. Off, it is a
   *  read-only render that lets clicks fall through to the text underneath. */
  active: boolean;
  eraser: boolean;
  color: AssetLabel;
  size: number;
  onCommit: (strokes: NoteStroke[]) => void;
}

/** A FIXED virtual drawing space. Points are stored in these 0..1000 units, and
 *  the SVG (preserveAspectRatio="none") stretches them to fill whatever size the
 *  note currently is — so the drawing scales with the card on resize and the
 *  stored coordinates never depend on the note's dimensions at draw time. */
const VB = 1000;

/** Freehand drawing ON a sticky note (ADR 0041 — the pencil moved off the canvas
 *  and onto the note). Self-contained: its own pointer capture in the note's
 *  local coordinate space, sharing only the pure geometry in `lib/ink`. The live
 *  stroke is written straight to the DOM (like the old canvas ink) so a Pencil
 *  sampling at 120 Hz is not 120 React renders. */
export default function NoteInkLayer({ strokes, active, eraser, color, size, onCommit }: NoteInkLayerProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const liveRef = useRef<SVGPathElement | null>(null);
  const pointsRef = useRef<InkPoint[]>([]);
  const boxRef = useRef<DOMRect | null>(null);
  const drawingRef = useRef(false);
  /** The pointer that owns the stroke in progress. Without it, a palm landing on
   *  the glass mid-sentence fires its own pointerdown, resets `pointsRef` to the
   *  palm's single sample and destroys what the pen was drawing — and its
   *  pointerup commits the wreckage. One live pointer, and every later one is
   *  ignored until it lifts. */
  const strokePointerRef = useRef<number | null>(null);
  // Strokes the current erase drag has swept, by index, dimmed until release.
  const [pendingErase, setPendingErase] = useState<ReadonlySet<number>>(new Set());
  const eraseRef = useRef<Set<number>>(new Set());

  /** Screen px → the 0..1000 virtual space. Dividing by the rendered rect makes
   *  the mapping independent of both canvas zoom and the note's current size. */
  const toLocal = (clientX: number, clientY: number) => {
    const b = boxRef.current ?? svgRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, VB, VB);
    return { x: ((clientX - b.left) / b.width) * VB, y: ((clientY - b.top) / b.height) * VB };
  };

  const pressureOf = (pressure: number) => (pressure > 0 && pressure <= 1 ? pressure : 0);

  const eraseAt = (clientX: number, clientY: number) => {
    const p = toLocal(clientX, clientY);
    const b = boxRef.current;
    const radius = (b ? (12 / b.width) * VB : 12) + size / 2;
    let added = false;
    strokes.forEach((stroke, i) => {
      if (eraseRef.current.has(i)) return;
      if (distanceToStroke(stroke.points, p.x, p.y) <= radius + stroke.size / 2) {
        eraseRef.current.add(i);
        added = true;
      }
    });
    if (added) setPendingErase(new Set(eraseRef.current));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!active || e.button !== 0) return;
    // A stroke is already live: this is a palm, a second finger, or a stray
    // click. It is not a new stroke and it must not touch the current one.
    if (drawingRef.current) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    strokePointerRef.current = e.pointerId;
    boxRef.current = svgRef.current?.getBoundingClientRect() ?? null;
    drawingRef.current = true;
    if (eraser) {
      eraseRef.current = new Set();
      eraseAt(e.clientX, e.clientY);
      return;
    }
    const p = toLocal(e.clientX, e.clientY);
    pointsRef.current = [[p.x, p.y, pressureOf(e.pressure)]];
    liveRef.current?.setAttribute("d", strokePath(pointsRef.current));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawingRef.current || e.pointerId !== strokePointerRef.current) return;
    e.stopPropagation();
    if (eraser) {
      eraseAt(e.clientX, e.clientY);
      return;
    }
    // getCoalescedEvents (on the native event): pointermove fires once per frame
    // while a Pencil samples at 120 Hz, so without this a fast stroke arrives as
    // a handful of points and renders as a polygon.
    const native = e.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const samples = coalesced.length > 0 ? coalesced : [native];
    for (const s of samples) {
      const p = toLocal(s.clientX, s.clientY);
      pointsRef.current.push([p.x, p.y, pressureOf(s.pressure)]);
    }
    if (pointsRef.current.length > INK_MAX_POINTS) {
      pointsRef.current = simplifyStroke(pointsRef.current, 1.2);
    }
    liveRef.current?.setAttribute("d", strokePath(pointsRef.current));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    // Only the pointer that started the stroke ends it — a palm lifting while
    // the pen is still writing would otherwise commit mid-sentence.
    if (!drawingRef.current || e.pointerId !== strokePointerRef.current) return;
    e.stopPropagation();
    drawingRef.current = false;
    strokePointerRef.current = null;
    if (eraser) {
      const gone = eraseRef.current;
      eraseRef.current = new Set();
      setPendingErase(new Set());
      if (gone.size > 0) onCommit(strokes.filter((_, i) => !gone.has(i)));
      return;
    }
    const raw = pointsRef.current;
    pointsRef.current = [];
    liveRef.current?.setAttribute("d", "");
    if (raw.length === 0) return;
    const simplified = simplifyStroke(raw);
    // A tap is a legitimate dot, but the schema needs two points — duplicate it.
    const points = simplified.length >= 2 ? simplified : [simplified[0], simplified[0]];
    const rounded = points.map(([x, y, p]) => [round(x), round(y), round(p, 100)] as InkPoint);
    onCommit([...strokes, { points: rounded, color, size }]);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VB} ${VB}`}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: active ? "auto" : "none",
        touchAction: active ? "none" : "auto",
        cursor: active ? "crosshair" : "default",
        zIndex: 1,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {strokes.map((stroke, i) => (
        <Stroke key={i} stroke={stroke} erasing={pendingErase.has(i)} />
      ))}
      {/* The live stroke — `d` is written imperatively while the pen is down. */}
      <path ref={liveRef} fill="none" stroke={LABEL_COLORS[color]} strokeWidth={size} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Stroke({ stroke, erasing }: { stroke: NoteStroke; erasing: boolean }) {
  const color = LABEL_COLORS[stroke.color];
  return (
    <g opacity={erasing ? 0.25 : 1}>
      {pressureSegments(stroke.points).map((segment, i) => (
        <path
          key={i}
          d={strokePath(segment.points)}
          fill="none"
          stroke={color}
          strokeWidth={bandWidth(segment.band, stroke.size)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
}

const round = (v: number, factor = 10) => Math.round(v * factor) / factor;
