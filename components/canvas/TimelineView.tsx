import type { Photo } from "@/types";
import { monthOf, type TimelineLayout } from "@/lib/layout";

interface TimelineViewProps {
  layout: TimelineLayout;
  photos: Photo[];
  selectedIds: Set<string>;
  onTlDown: (
    e: React.PointerEvent,
    id: string,
    orig: { x: number; y: number },
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ) => void;
}

export default function TimelineView({ layout, photos, selectedIds, onTlDown }: TimelineViewProps) {
  const { months, tiles, colWidth } = layout;
  const monthX: Record<string, number> = {};
  const monthH: Record<string, number> = {};
  months.forEach((m) => {
    monthX[m.key] = m.x;
    monthH[m.key] = m.colH;
  });

  return (
    <>
      {months.map((mo) => (
        <div
          key={mo.key}
          style={{
            position: "absolute",
            left: mo.x,
            top: 0,
            width: colWidth,
            height: mo.colH,
            background: "rgba(255,255,255,0.012)",
            borderLeft: "1px solid var(--bd)",
            borderRight: "1px solid var(--bd)",
          }}
        />
      ))}
      {photos.map((p, i) => {
        const tp = tiles[p.id];
        if (!tp) return null;
        const selected = selectedIds.has(p.id);
        const month = monthOf(p);
        const colX = monthX[month] ?? tp.x;
        const bounds = {
          minX: colX,
          maxX: colX + colWidth - tp.w,
          minY: 0,
          maxY: (monthH[month] ?? tp.y + tp.h) - tp.h,
        };
        return (
          <div
            key={p.id}
            onPointerDown={(e) => onTlDown(e, p.id, { x: tp.x, y: tp.y }, bounds)}
            style={{
              position: "absolute",
              left: tp.x,
              top: tp.y,
              width: tp.w,
              height: tp.h,
              borderRadius: 2,
              overflow: "hidden",
              border: "1px solid var(--bd)",
              cursor: "grab",
              backgroundImage: `url(https://picsum.photos/seed/${p.seed}/${p.w}/${p.h})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              zIndex: selected ? 10 : i,
            }}
          >
            {selected && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(57,255,106,.18)",
                  border: "2px solid var(--ac)",
                }}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
