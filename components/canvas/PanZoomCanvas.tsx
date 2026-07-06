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
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 6000,
          height: 4000,
          transformOrigin: "0 0",
          transform: canvasTransform,
          backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        {children}
      </div>
      {marquee.show && (
        <MarqueeOverlay left={marquee.left} top={marquee.top} width={marquee.width} height={marquee.height} />
      )}
    </div>
  );
}
