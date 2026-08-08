import { memo } from "react";
import type { InkAnnotation } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import { bandWidth, pressureSegments, strokePath } from "@/lib/ink";

interface InkOverlayProps {
  strokes: InkAnnotation[];
  /** Strokes under the eraser right now — dimmed so it is clear what a release
   *  will remove, rather than having them vanish under the cursor. */
  pendingErase: ReadonlySet<string>;
}

/** Freehand ink on the Workspace canvas (ADR 0041).
 *
 *  One `<svg>` for every committed stroke plus a live one for the stroke being
 *  drawn. Both sit INSIDE the canvas's transformed content, so ink pans and
 *  zooms with the photos it was drawn over and needs no transform of its own.
 *
 *  The layer is a REAL, very large box rather than a 0×0 element with
 *  `overflow: visible`. That looked like the elegant answer — the canvas has no
 *  bounds, so there is no honest rectangle to size it to — and it renders
 *  nothing at all: a zero-sized SVG viewport paints no content in Chrome even
 *  with overflow visible, while still reporting correct `getBoundingClientRect`
 *  values for its children, so it fails completely and silently.
 *
 *  `REACH` is CANVAS_COORD_MAX, the bound the annotation schema already
 *  enforces on x/y. So the box provably contains every coordinate the server
 *  will accept, and the inner translate puts canvas 0,0 back at the layer's
 *  middle. Nothing outside the viewport is rasterised, so the size is a
 *  coordinate-space claim, not a memory one. */
const REACH = 1_000_000;

const LAYER_STYLE: React.CSSProperties = {
  position: "absolute",
  left: -REACH,
  top: -REACH,
  width: REACH * 2,
  height: REACH * 2,
  pointerEvents: "none",
  zIndex: 14,
};

function InkOverlayImpl({ strokes, pendingErase }: InkOverlayProps) {
  return (
    <svg style={LAYER_STYLE} aria-hidden="true">
      <g transform={`translate(${REACH} ${REACH})`}>
        {strokes.map((stroke) => (
          <Stroke key={stroke.id} stroke={stroke} erasing={pendingErase.has(stroke.id)} />
        ))}
      </g>
    </svg>
  );
}

/** Memoised per stroke: an erase drag re-renders the layer on every pointermove,
 *  and a canvas with a few hundred strokes must not rebuild every path for it. */
const Stroke = memo(function Stroke({ stroke, erasing }: { stroke: InkAnnotation; erasing: boolean }) {
  const color = LABEL_COLORS[stroke.color];
  return (
    <g
      // Points are stored relative to the row's own origin (so a stroke can be
      // moved by patching two columns), so the translate puts them back.
      transform={`translate(${stroke.x} ${stroke.y})`}
      opacity={erasing ? 0.25 : 1}
    >
      {pressureSegments(stroke.body.points).map((segment, i) => (
        <path
          key={i}
          d={strokePath(segment.points)}
          fill="none"
          stroke={color}
          strokeWidth={bandWidth(segment.band, stroke.body.size)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
});

export default memo(InkOverlayImpl);

/** The stroke being drawn right now. Deliberately NOT driven by React state: a
 *  Pencil reports at 120 Hz, and every sample would be a render of the whole
 *  canvas. The input layer owns a ref to this path and writes `d` straight onto
 *  the DOM node while the pen is down, then commits one annotation on release. */
/** `attachPath` rather than `ref`: `react-hooks/refs` treats a member expression
 *  in a `ref=` prop as accessing a ref during render, and one `ref={ws.setX}`
 *  taints every `ws.*` read in the consumer's whole render. A plainly named
 *  callback prop is the same wiring without that. */
export function LiveStroke({
  color,
  width,
  attachPath,
}: {
  color: string;
  width: number;
  attachPath: (el: SVGPathElement | null) => void;
}) {
  return (
    <svg style={LAYER_STYLE} aria-hidden="true">
      <g transform={`translate(${REACH} ${REACH})`}>
        <path
          ref={attachPath}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
