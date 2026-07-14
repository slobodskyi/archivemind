import { memo } from "react";
import type { Photo } from "@/types";
import { photoSrc } from "@/lib/img";
import type { ColumnGridLayout } from "@/lib/layout";
import PhotoTile from "./PhotoTile";

interface ColumnGridViewProps {
  layout: ColumnGridLayout;
  photos: Photo[];
  selectedIds: Set<string>;
  hoveredId: string | null;
  onTileDown: (
    e: React.PointerEvent,
    id: string,
    orig: { x: number; y: number },
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ) => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
}

/** Shared renderer for Timeline, Map, and Topic — all three are the same
 *  fixed-width column grid (ADR 0017), bucketed differently by lib/layout.ts
 *  (month / country / group) and header-labeled accordingly. */
function ColumnGridView({
  layout,
  photos,
  selectedIds,
  hoveredId,
  onTileDown,
  setHover,
  openDrawer,
  deletePhoto,
}: ColumnGridViewProps) {
  const colX: Record<string, number> = {};
  const colH: Record<string, number> = {};
  layout.columns.forEach((c) => {
    colX[c.key] = c.x;
    colH[c.key] = c.colH;
  });

  return (
    <>
      {photos.map((p) => {
        const tp = layout.tiles[p.id];
        if (!tp) return null;
        const bounds = {
          minX: colX[tp.columnKey] ?? tp.x,
          maxX: (colX[tp.columnKey] ?? tp.x) + layout.colWidth - tp.w,
          minY: 0,
          maxY: (colH[tp.columnKey] ?? tp.y + tp.h) - tp.h,
        };
        const pos = { x: tp.x, y: tp.y, w: tp.w, h: tp.h, cx: tp.x + tp.w / 2, cy: tp.y + tp.h / 2 };
        const src = p.src ?? photoSrc(p, tp.w * 2, tp.h * 2);
        return (
          <PhotoTile
            key={p.id}
            src={src}
            filename={p.filename}
            pos={pos}
            stage="ready"
            selected={selectedIds.has(p.id)}
            hovered={hoveredId === p.id}
            interactive
            onDown={(e) => onTileDown(e, p.id, { x: tp.x, y: tp.y }, bounds)}
            onEnter={() => setHover(p.id)}
            onLeave={() => setHover(null)}
            onOpen={() => openDrawer(p.id)}
            onDelete={(e) => {
              e.stopPropagation();
              deletePhoto(p.id);
            }}
          />
        );
      })}
    </>
  );
}

export default memo(ColumnGridView);
