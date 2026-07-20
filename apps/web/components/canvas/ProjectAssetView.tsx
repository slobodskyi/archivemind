import { memo, useMemo } from "react";
import { photoSrc } from "@/lib/img";
import type { TilePos } from "@/lib/layout";
import type { CanvasPoint, CanvasUploadPreview, Photo } from "@/types";
import PhotoTile from "./PhotoTile";

interface ProjectAssetViewProps {
  photos: Photo[];
  previews: CanvasUploadPreview[];
  /** Positions for canonical photos in the active view (grid or cloud). */
  positions: Record<string, TilePos>;
  /** Positions for pending uploads — always the neutral grid, since a file has
   *  no month/country/topic to sort by until the worker processes it. */
  previewPositions: Record<string, TilePos>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  /** True while a view/sort switch reflows every tile — enables the glide. */
  animating: boolean;
  /** When a cloud is focused (its label clicked), tiles in other clouds fade. */
  focusedCloudKey: string | null;
  /** Tile id → cloud key, for the fade above. Empty on the unsorted Canvas. */
  tileCloud: Record<string, string>;
  onTileDown: (event: React.PointerEvent, id: string, center: CanvasPoint) => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
}

function ProjectAssetView({
  photos,
  previews,
  positions,
  previewPositions,
  selectedIds,
  hoveredId,
  animating,
  focusedCloudKey,
  tileCloud,
  onTileDown,
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
            animating={animating}
            dimmed={!!focusedCloudKey && tileCloud[photo.id] !== focusedCloudKey}
            onDown={(event) => onTileDown(event, photo.id, { x: pos.cx, y: pos.cy })}
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
        const pos = previewPositions[id];
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
            animating={animating}
          />
        );
      })}
    </>
  );
}

export default memo(ProjectAssetView);
