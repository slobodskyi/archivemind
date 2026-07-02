import type { ReactNode } from "react";
import MarqueeOverlay from "./MarqueeOverlay";

interface PanZoomCanvasProps {
  setCanvasRef: (el: HTMLDivElement | null) => void;
  onCanvasDown: (e: React.PointerEvent) => void;
  canvasCursor: string;
  canvasTransform: string;
  marquee: { show: boolean; left: number; top: number; width: number; height: number };
  children: ReactNode;
}

export default function PanZoomCanvas({
  setCanvasRef,
  onCanvasDown,
  canvasCursor,
  canvasTransform,
  marquee,
  children,
}: PanZoomCanvasProps) {
  return (
    <div
      ref={setCanvasRef}
      onPointerDown={onCanvasDown}
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        cursor: canvasCursor,
        zIndex: 1,
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
