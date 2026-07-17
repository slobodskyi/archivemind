import type { CanvasUploadStage } from "@/types";
import type { TilePos } from "@/lib/layout";
import { CloseIcon } from "@/components/icons/icons";

interface PhotoTileProps {
  src: string | null;
  filename: string;
  pos: TilePos;
  stage: CanvasUploadStage;
  message?: string | null;
  selected: boolean;
  hovered: boolean;
  interactive: boolean;
  /** When true, the tile glides to a new position instead of snapping — used
   *  while a sort/view change reflows every tile at once (not during drag). */
  animating?: boolean;
  onDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onEnter?: () => void;
  onLeave?: () => void;
  onOpen?: () => void;
  /** Shown as a small hover button, top-right of the tile — every view that
   *  renders a PhotoTile gets file deletion for free (issue: delete on any view). */
  onDelete?: (e: React.MouseEvent) => void;
}

const STAGE_LABEL: Record<Exclude<CanvasUploadStage, "ready">, string> = {
  uploading: "Uploading",
  processing: "Processing",
  error: "Needs attention",
};

export default function PhotoTile({
  src,
  filename,
  pos,
  stage,
  message,
  selected,
  hovered,
  interactive,
  animating,
  onDown,
  onEnter,
  onLeave,
  onOpen,
  onDelete,
}: PhotoTileProps) {
  const zIndex = hovered ? 30 : selected ? 12 : 2;
  const status = stage === "ready" ? "" : `, ${STAGE_LABEL[stage]}`;

  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        zIndex,
        transition: animating ? "left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1)" : undefined,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
    <button
      type="button"
      disabled={!interactive}
      aria-label={`${filename}${status}`}
      title={message ?? filename}
      onPointerDown={interactive ? onDown : undefined}
      onDoubleClick={interactive ? onOpen : undefined}
      onKeyDown={(event) => {
        if (interactive && event.key === "Enter") onOpen?.();
      }}
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        padding: 0,
        border: 0,
        background: "transparent",
        color: "inherit",
        font: "inherit",
        textAlign: "left",
        cursor: interactive ? "grab" : "default",
      }}
    >
      {selected && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: -5,
            border: "2px solid var(--ac2)",
            borderRadius: 3,
            pointerEvents: "none",
          }}
        />
      )}
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "block",
          width: "100%",
          height: pos.h,
          overflow: "hidden",
          border: `1px solid ${stage === "error" ? "var(--red)" : selected ? "var(--ac2)" : "var(--bd)"}`,
          borderRadius: 3,
          background: "var(--bg-in)",
          backgroundImage: src ? `url(${src})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          boxShadow: hovered ? "0 12px 28px rgba(0,0,0,.42)" : "none",
        }}
      >
        {!src && (
          <span
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              color: "var(--t3)",
              fontSize: 10,
              letterSpacing: ".08em",
              textTransform: "uppercase",
            }}
          >
            {filename.split(".").pop()?.slice(0, 5) || "FILE"}
          </span>
        )}
        {hovered && <span style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.16)" }} />}
        {stage !== "ready" && (
          <span
            style={{
              position: "absolute",
              left: 7,
              bottom: 7,
              maxWidth: "calc(100% - 14px)",
              padding: "4px 6px",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 2,
              background: "rgba(8,8,8,.82)",
              color: stage === "error" ? "var(--red)" : "var(--t2)",
              fontSize: 9.5,
              lineHeight: 1,
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {STAGE_LABEL[stage]}
          </span>
        )}
      </span>
      <span
        style={{
          display: "block",
          marginTop: 6,
          overflow: "hidden",
          color: stage === "error" ? "var(--red)" : "var(--t2)",
          fontSize: 10.5,
          lineHeight: 1.3,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {filename}
      </span>
    </button>
    {interactive && onDelete && hovered && (
      <button
        type="button"
        aria-label={`Delete ${filename}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onDelete}
        style={{
          position: "absolute",
          top: 4,
          right: 4,
          display: "flex",
          width: 20,
          height: 20,
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(255,255,255,.14)",
          borderRadius: 2,
          background: "rgba(10,10,10,.65)",
          color: "#fff",
          cursor: "pointer",
          zIndex: 5,
        }}
      >
        <CloseIcon width={10} height={10} strokeWidth={2.2} />
      </button>
    )}
    </div>
  );
}
