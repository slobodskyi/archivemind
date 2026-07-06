interface MarqueeOverlayProps {
  left: number;
  top: number;
  width: number;
  height: number;
}

export default function MarqueeOverlay({ left, top, width, height }: MarqueeOverlayProps) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        background: "rgba(57,255,106,.08)",
        border: "1px solid var(--ac2)",
        borderRadius: 2,
        pointerEvents: "none",
      }}
    />
  );
}
