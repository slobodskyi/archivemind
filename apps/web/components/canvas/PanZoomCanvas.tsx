import type { ReactNode } from "react";
import MarqueeOverlay from "./MarqueeOverlay";

interface PanZoomCanvasProps {
  setCanvasRef: (el: HTMLDivElement | null) => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  /** Right-click on empty canvas (tiles stop propagation and handle their own). */
  onCanvasContext?: (e: React.MouseEvent) => void;
  canvasCursor: string;
  canvasTransform: string;
  /** True only while a view/sort switch re-fits the viewport — glides the pan/zoom
   *  so the reflow feels like one page settling, not a page swap. Off during
   *  normal pan/zoom so those stay 1:1 with the pointer. */
  animating: boolean;
  marquee: { show: boolean; left: number; top: number; width: number; height: number };
  children: ReactNode;
}

export default function PanZoomCanvas({
  setCanvasRef,
  onCanvasDown,
  onCanvasContext,
  canvasCursor,
  canvasTransform,
  animating,
  marquee,
  children,
}: PanZoomCanvasProps) {
  return (
    <div
      ref={setCanvasRef}
      onPointerDown={onCanvasDown}
      onContextMenu={onCanvasContext}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        cursor: canvasCursor,
        zIndex: 1,
        // The canvas is a spatial drag surface, not a document: a pan/marquee/tile
        // drag must never double as a native text-selection gesture that highlights
        // every filename label it sweeps over. Editable widgets (the sticky-note
        // textarea, chat/drawer) re-enable selection on their own elements.
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 1,
          height: 1,
          transformOrigin: "0 0",
          transform: canvasTransform,
          transition: animating ? "transform .45s cubic-bezier(.4,0,.2,1)" : undefined,
        }}
      >
        {children}
      </div>
      {marquee.show && (
        <MarqueeOverlay
          left={marquee.left}
          top={marquee.top}
          width={marquee.width}
          height={marquee.height}
        />
      )}
    </div>
  );
}
