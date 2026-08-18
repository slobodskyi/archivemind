import { memo, useMemo } from "react";
import type { LabelNames } from "@archivemind/shared";
import { photoSrc, isRealSource } from "@/lib/img";
import type { TilePos } from "@/lib/layout";
import type { CanvasPoint, CanvasUploadPreview, Photo } from "@/types";
import PhotoTile from "./PhotoTile";

interface ProjectAssetViewProps {
  photos: Photo[];
  previews: CanvasUploadPreview[];
  /** Positions for canonical photos in the active view (grid or cloud). */
  positions: Record<string, TilePos>;
  /** Positions for pending uploads — always the neutral grid, since a file has
   *  no capture date/country/topic to sort by until the worker processes it. */
  previewPositions: Record<string, TilePos>;
  selectedIds: Set<string>;
  hoveredId: string | null;
  /** True while a view/sort switch reflows every tile — enables the glide. */
  animating: boolean;
  /** Per-tile stacking delta from "Bring to front / Send to back" (default 0). */
  zOrder: Record<string, number>;
  /** When a cloud is focused (its label clicked), tiles in other clouds fade. */
  focusedCloudKey: string | null;
  /** Tile id → cloud key, for the fade above. Empty on the unsorted Canvas. */
  tileCloud: Record<string, string>;
  /** Assets inside the AI job that is running right now. */
  aiBusyIds: Set<string>;
  onTileDown: (event: React.PointerEvent, id: string, center: CanvasPoint) => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
  openContextMenu: (x: number, y: number, targetId: string | null) => void;
  /** Analyze one photo straight from its tile badge. */
  analyzePhoto: (id: string) => void;
  /** The workspace's colour names, so a tile's dot can carry the user's own
   *  word for it ("Rejected") rather than the raw colour. */
  labelNames: LabelNames;
  /** Wire ports (ADR 0048) — provided only on the neural view with an open
   *  Workspace, which is the only place edges exist. */
  onEdgeStart?: (event: React.PointerEvent, id: string, center: CanvasPoint) => void;
  /** The tile an in-flight wire is hovering, for its drop ring. */
  edgeDropTargetId?: string | null;
}

function ProjectAssetView({
  photos,
  previews,
  positions,
  previewPositions,
  selectedIds,
  hoveredId,
  animating,
  zOrder,
  focusedCloudKey,
  tileCloud,
  aiBusyIds,
  onTileDown,
  setHover,
  openDrawer,
  deletePhoto,
  openContextMenu,
  analyzePhoto,
  labelNames,
  onEdgeStart,
  edgeDropTargetId = null,
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
        const src = photo.src ?? preview?.localUrl ?? (isRealSource(photo.source) ? null : photoSrc(photo, pos.w * 2, pos.h * 2));
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
            z={zOrder[photo.id] ?? 0}
            dimmed={!!focusedCloudKey && tileCloud[photo.id] !== focusedCloudKey}
            onDown={(event) => onTileDown(event, photo.id, { x: pos.cx, y: pos.cy })}
            onEnter={() => setHover(photo.id)}
            onLeave={() => setHover(null)}
            onOpen={() => openDrawer(photo.id)}
            onContext={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openContextMenu(event.clientX, event.clientY, photo.id);
            }}
            onDelete={(e) => {
              e.stopPropagation();
              deletePhoto(photo.id);
            }}
            analyzed={photo.processed}
            aiBusy={aiBusyIds.has(photo.id)}
            label={photo.label ?? null}
            labelName={photo.label ? labelNames[photo.label] : undefined}
            // Mock rows have no asset to enqueue against — they get the plain
            // indicator, not a button that would 404 in the jobs API.
            onAnalyze={
              isRealSource(photo.source)
                ? (e) => {
                    e.stopPropagation();
                    analyzePhoto(photo.id);
                  }
                : undefined
            }
            // Mock rows are not board members, so a wire from one could never
            // be stored — same gate as the AI badge above.
            onEdgeStart={
              onEdgeStart && isRealSource(photo.source)
                ? (event) => onEdgeStart(event, photo.id, { x: pos.cx, y: pos.cy })
                : undefined
            }
            edgeDropTarget={edgeDropTargetId === photo.id}
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
