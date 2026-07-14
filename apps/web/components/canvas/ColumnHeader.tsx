import type { ColumnGridLayout } from "@/lib/layout";

interface ColumnHeaderProps {
  layout: ColumnGridLayout;
  tx: number;
  scale: number;
}

/** Shared sticky header for Timeline/Map/Topic's column grid — shows each
 *  column's label (month / country / topic) + file count. */
export default function ColumnHeader({ layout, tx, scale }: ColumnHeaderProps) {
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
      {layout.columns.map((col) => (
        <div
          key={col.key}
          style={{
            position: "absolute",
            left: tx + col.x * scale,
            top: 14,
            width: layout.colWidth * scale,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", letterSpacing: "0.02em" }}>
            {col.label}
          </span>
          <span style={{ fontSize: 11, color: "var(--t3)", marginLeft: 8 }}>{col.count} files</span>
        </div>
      ))}
    </div>
  );
}
