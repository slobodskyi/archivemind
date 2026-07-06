import type { TilePos } from "@/lib/layout";
import { OpenIcon, CloseIcon, SparkleIcon, TagIcon, BookmarkIcon } from "@/components/icons/icons";

interface PhotoTileProps {
  seed: string;
  pos: TilePos;
  selected: boolean;
  hovered: boolean;
  bookmarked: boolean;
  anim: string;
  transition: string;
  /** Bottom pill chip shown on processed photos wide enough to hold it. */
  showChip: boolean;
  chip: string | null;
  dotColor: string;
  onDown: (e: React.PointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
  /** Both the Caption and Tag hover buttons call this — matches the source, which binds them to the same handler. */
  onOpen: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onBookmark: (e: React.MouseEvent) => void;
}

export default function PhotoTile({
  seed,
  pos,
  selected,
  hovered,
  bookmarked,
  anim,
  transition,
  showChip,
  chip,
  dotColor,
  onDown,
  onEnter,
  onLeave,
  onOpen,
  onDelete,
  onBookmark,
}: PhotoTileProps) {
  const src = `https://picsum.photos/seed/${seed}/${pos.w * 2}/${pos.h * 2}`;
  const z = hovered ? 30 : selected ? 12 : 2;

  return (
    <div
      onPointerDown={onDown}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        zIndex: z,
        animation: anim,
        transition,
      }}
    >
      {selected && (
        <div
          style={{
            position: "absolute",
            left: -5,
            top: -5,
            right: -5,
            bottom: -5,
            border: "2px solid var(--accent-indigo)",
            borderRadius: 6,
            pointerEvents: "none",
          }}
        >
          <div style={{ position: "absolute", left: -4, top: -4, width: 8, height: 8, background: "#fff", borderRadius: 1 }} />
          <div style={{ position: "absolute", right: -4, top: -4, width: 8, height: 8, background: "#fff", borderRadius: 1 }} />
          <div style={{ position: "absolute", left: -4, bottom: -4, width: 8, height: 8, background: "#fff", borderRadius: 1 }} />
          <div style={{ position: "absolute", right: -4, bottom: -4, width: 8, height: 8, background: "#fff", borderRadius: 1 }} />
        </div>
      )}
      <div
        style={{
          position: "relative",
          borderRadius: 3,
          overflow: "hidden",
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-inner)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: pos.h,
            backgroundImage: `url(${src})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        {hovered && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.28)", pointerEvents: "none" }} />
        )}
        {showChip && chip && (
          <div
            style={{
              position: "absolute",
              left: 6,
              right: 6,
              bottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(20,20,20,.92)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 999,
              padding: "4px 9px",
              backdropFilter: "blur(8px)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, flex: "0 0 auto", background: dotColor }} />
            <span style={{ fontSize: 11, color: "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {chip}
            </span>
          </div>
        )}
      </div>
      {hovered && (
        <>
          <div
            style={{
              position: "absolute",
              top: -40,
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: 2,
              background: "rgba(26,26,26,.95)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 999,
              padding: 4,
              backdropFilter: "blur(12px)",
              boxShadow: "0 8px 24px rgba(0,0,0,.5)",
              zIndex: 5,
            }}
          >
            <button onClick={onOpen} title="Caption" aria-label="Caption photo" style={hoverBtnStyle("var(--text-secondary)")}>
              <SparkleIcon width={15} height={15} strokeWidth={1.6} />
            </button>
            <button onClick={onOpen} title="Tag" aria-label="Tag photo" style={hoverBtnStyle("var(--text-secondary)")}>
              <TagIcon width={15} height={15} strokeWidth={1.6} />
            </button>
            <button onClick={onOpen} title="Open" aria-label="Open photo" style={hoverBtnStyle("var(--text-secondary)")}>
              <OpenIcon width={15} height={15} strokeWidth={1.6} />
            </button>
            <button onClick={onDelete} title="Delete" aria-label="Delete photo" style={hoverBtnStyle("var(--danger)")}>
              <CloseIcon width={15} height={15} strokeWidth={1.6} />
            </button>
          </div>
          <button
            onClick={onBookmark}
            title="Bookmark"
            aria-label="Toggle bookmark"
            style={{
              position: "absolute",
              top: 7,
              right: 7,
              display: "flex",
              width: 26,
              height: 26,
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--border-subtle)",
              background: "rgba(20,20,20,.9)",
              color: bookmarked ? "#fff" : "var(--text-secondary)",
              borderRadius: 999,
              cursor: "pointer",
              backdropFilter: "blur(8px)",
              zIndex: 5,
            }}
          >
            <BookmarkIcon filled={bookmarked} />
          </button>
        </>
      )}
    </div>
  );
}

function hoverBtnStyle(color: string): React.CSSProperties {
  return {
    display: "flex",
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    border: 0,
    background: "transparent",
    color,
    borderRadius: 999,
    cursor: "pointer",
  };
}
