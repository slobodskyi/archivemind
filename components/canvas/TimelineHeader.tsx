import type { TimelineLayout } from "@/lib/layout";

interface TimelineHeaderProps {
  layout: TimelineLayout;
  tx: number;
  scale: number;
}

export default function TimelineHeader({ layout, tx, scale }: TimelineHeaderProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 52,
        right: 0,
        height: 48,
        overflow: "hidden",
        background: "var(--bg)",
        borderBottom: "1px solid var(--bd)",
        zIndex: 20,
      }}
    >
      {layout.months.map((mo) => (
        <div
          key={mo.key}
          style={{
            position: "absolute",
            left: tx + mo.x * scale,
            top: 14,
            width: layout.colWidth * scale,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", letterSpacing: "0.02em" }}>
            {mo.key}
          </span>
          <span style={{ fontSize: 11, color: "var(--t3)", marginLeft: 8 }}>{mo.count} files</span>
        </div>
      ))}
    </div>
  );
}
