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
        background: "rgba(91,106,240,0.15)",
        border: "1px solid var(--accent-indigo)",
        borderRadius: 2,
        pointerEvents: "none",
      }}
    />
  );
}
