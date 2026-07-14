import { memo, useMemo } from "react";
import { photoSrc } from "@/lib/img";
import type { TilePos } from "@/lib/layout";
import type { CanvasPoint, CanvasUploadPreview, Photo } from "@/types";
import PhotoTile from "./PhotoTile";

interface ProjectAssetViewProps {
  photos: Photo[];
  previews: CanvasUploadPreview[];
  positions: Record<string, TilePos>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  onAssetDown: (event: React.PointerEvent, id: string, center: CanvasPoint) => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
}

function ProjectAssetView({
  photos,
  previews,
  positions,
  selectedIds,
  hoveredId,
  onAssetDown,
  setHover,
  openDrawer,
  deletePhoto,
}: ProjectAssetViewProps) {
  const previewByAsset = useMemo(
    () => new Map(previews.flatMap((preview) => preview.assetId ? [[preview.assetId, preview]] : [])),
    [previews],
  );
  const canonicalIds = useMemo(() => new Set(photos.map((photo) => photo.id)), [photos]);
  const pending = previews.filter((preview) => !preview.assetId || !canonicalIds.has(preview.assetId));

  return (
    <>
      {photos.map((photo) => {
        const pos = positions[photo.id];
        if (!pos) return null;
        const preview = previewByAsset.get(photo.id);
        const src = photo.src ?? preview?.localUrl ?? (photo.source === "upload" ? null : photoSrc(photo, pos.w * 2, pos.h * 2));
        const stage = photo.src || photo.source !== "upload"
          ? "ready"
          : preview?.stage ?? "ready";
        return (
          <PhotoTile
            key={photo.id}
            src={src}
            filename={photo.filename}
            pos={pos}
            stage={stage}
            message={preview?.message ?? (!src ? "Preview unavailable" : null)}
            selected={selectedIds.has(photo.id)}
            hovered={hoveredId === photo.id}
            interactive
            onDown={(event) => onAssetDown(event, photo.id, { x: pos.cx, y: pos.cy })}
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
      {pending.map((preview) => {
        const id = preview.assetId ?? preview.clientId;
        const pos = positions[id];
        if (!pos) return null;
        return (
          <PhotoTile
            key={preview.clientId}
            src={preview.localUrl}
            filename={preview.filename}
            pos={pos}
            stage={preview.stage}
            message={preview.message}
            selected={false}
            hovered={false}
            interactive={false}
          />
        );
      })}
    </>
  );
}

export default memo(ProjectAssetView);
