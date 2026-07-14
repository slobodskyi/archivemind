import { memo } from "react";
import type { CanvasPoint, Photo } from "@/types";
import { photoSrc } from "@/lib/img";
import type { CloudLayout } from "@/lib/layout";
import PhotoTile from "./PhotoTile";

interface CloudViewProps {
  layout: CloudLayout;
  photos: Photo[];
  selectedIds: Set<string>;
  hoveredId: string | null;
  onTileDown: (e: React.PointerEvent, id: string, center: CanvasPoint) => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
}

/** Shared renderer for Map and Topic (ADR 0018): photos cluster into a
 *  labeled "cloud" per country/topic, each tile connected to its cloud's hub
 *  by a line in that cloud's color; photos sharing the other dimension
 *  across clouds get a direct gradient-colored line between them. Tiles drag
 *  freely, exactly like the Canvas asset grid. */
function CloudView({ layout, photos, selectedIds, hoveredId, onTileDown, setHover, openDrawer, deletePhoto }: CloudViewProps) {
  return (
    <>
      <svg style={{ position: "absolute", left: 0, top: 0, width: 1600, height: 1100, overflow: "visible", pointerEvents: "none" }}>
        <defs>
          {layout.edges
            .filter((e) => e.strokeStart !== e.strokeEnd)
            .map((e) => (
              <linearGradient key={e.id} id={`cloud-grad-${e.id}`} gradientUnits="userSpaceOnUse" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}>
                <stop offset="0%" stopColor={e.strokeStart} />
                <stop offset="100%" stopColor={e.strokeEnd} />
              </linearGradient>
            ))}
        </defs>
        {layout.edges.map((e) => (
          <path
            key={e.id}
            d={e.d}
            stroke={e.strokeStart === e.strokeEnd ? e.strokeStart : `url(#cloud-grad-${e.id})`}
            strokeWidth={e.w}
            strokeOpacity={e.op}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </svg>

      {layout.clouds.map((c) => (
        <div
          key={c.key}
          style={{
            position: "absolute",
            left: c.hubX,
            top: c.hubY - c.radius - 26,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: c.color,
            pointerEvents: "none",
          }}
        >
          {c.label.toUpperCase()}
        </div>
      ))}

      {photos.map((photo) => {
        const pos = layout.tiles[photo.id];
        if (!pos) return null;
        const src = photo.src ?? photoSrc(photo, pos.w * 2, pos.h * 2);
        return (
          <PhotoTile
            key={photo.id}
            src={src}
            filename={photo.filename}
            pos={pos}
            stage="ready"
            selected={selectedIds.has(photo.id)}
            hovered={hoveredId === photo.id}
            interactive
            onDown={(e) => onTileDown(e, photo.id, { x: pos.cx, y: pos.cy })}
            onEnter={() => setHover(photo.id)}
            onLeave={() => setHover(null)}
            onOpen={() => openDrawer(photo.id)}
            onDelete={(e) => {
              e.stopPropagation();
              deletePhoto(photo.id);
            }}
          />
        );
      })}
    </>
  );
}

export default memo(CloudView);
