import type { Photo, PhotoSource } from "@/types";
import type { GalleryOverrides } from "@/lib/layout";
import { sourcesGallery } from "@/lib/layout";
import SourceTile from "./SourceTile";

interface NeuralViewProps {
  photos: Photo[];
  galleryOverrides: GalleryOverrides;
  onGalleryNodeDown: (
    e: React.PointerEvent,
    kind: "source",
    key: string,
    origCenter: { x: number; y: number },
  ) => void;
  /** Double-clicking a source tile opens/adds it as a tab in the Finder-style browser sidebar. */
  onHubOpen: (source: PhotoSource) => void;
}

export default function NeuralView({ photos, galleryOverrides, onGalleryNodeDown, onHubOpen }: NeuralViewProps) {
  const { tiles } = sourcesGallery(photos, galleryOverrides.source);
  return (
    <>
      {tiles.map((t) => (
        <SourceTile
          key={t.key}
          abbr={t.abbr}
          label={t.label}
          color={t.color}
          count={t.count}
          pos={t.pos}
          onOpen={() => onHubOpen(t.key)}
          onDragStart={(e, orig) => onGalleryNodeDown(e, "source", t.key, orig)}
        />
      ))}
    </>
  );
}
