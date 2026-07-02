import type { TilePos } from "@/lib/layout";
import { OpenIcon, CloseIcon } from "@/components/icons/icons";

interface PhotoTileProps {
  id: string;
  seed: string;
  /** Native dimensions for the picsum src (source uses w*2 × h*2). */
  natW: number;
  natH: number;
  pos: TilePos;
  selected: boolean;
  hovered: boolean;
  onDown: (e: React.PointerEvent) => void;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
}

export default function PhotoTile({
  seed,
  natW,
  natH,
  pos,
  selected,
  hovered,
  onDown,
  onEnter,
  onLeave,
  onOpen,
  onDelete,
}: PhotoTileProps) {
  const src = `https://picsum.photos/seed/${seed}/${natW * 2}/${natH * 2}`;
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
        transition:
          "left .55s cubic-bezier(.22,1,.36,1), top .55s cubic-bezier(.22,1,.36,1)",
        cursor: "grab",
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
            border: "2px solid var(--ac2)",
            borderRadius: 2,
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
          border: "1px solid var(--bd)",
          background: "var(--bg-in)",
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
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,.24)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      {hovered && (
        <div
          style={{
            position: "absolute",
            top: -38,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 2,
            background: "rgba(20,20,20,.95)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            padding: 3,
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 24px rgba(0,0,0,.5)",
            zIndex: 5,
          }}
        >
          <button
            onClick={onOpen}
            style={{
              display: "flex",
              width: 26,
              height: 26,
              alignItems: "center",
              justifyContent: "center",
              border: 0,
              background: "transparent",
              color: "var(--t2)",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            <OpenIcon />
          </button>
          <button
            onClick={onDelete}
            style={{
              display: "flex",
              width: 26,
              height: 26,
              alignItems: "center",
              justifyContent: "center",
              border: 0,
              background: "transparent",
              color: "var(--red)",
              borderRadius: 2,
              cursor: "pointer",
            }}
          >
            <CloseIcon width={13} height={13} strokeWidth={1.6} />
          </button>
        </div>
      )}
    </div>
  );
}
