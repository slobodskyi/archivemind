import type { CanvasUploadStage } from "@/types";
import type { TilePos } from "@/lib/layout";

interface PhotoTileProps {
  src: string | null;
  filename: string;
  pos: TilePos;
  stage: CanvasUploadStage;
  message?: string | null;
  selected: boolean;
  hovered: boolean;
  interactive: boolean;
  onDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onEnter?: () => void;
  onLeave?: () => void;
  onOpen?: () => void;
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
  onDown,
  onEnter,
  onLeave,
  onOpen,
}: PhotoTileProps) {
  const zIndex = hovered ? 30 : selected ? 12 : 2;
  const status = stage === "ready" ? "" : `, ${STAGE_LABEL[stage]}`;

  return (
    <button
      type="button"
      disabled={!interactive}
      aria-label={`${filename}${status}`}
      title={message ?? filename}
      onPointerDown={interactive ? onDown : undefined}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onDoubleClick={interactive ? onOpen : undefined}
      onKeyDown={(event) => {
        if (interactive && event.key === "Enter") onOpen?.();
      }}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        padding: 0,
        border: 0,
        background: "transparent",
        color: "inherit",
        font: "inherit",
        textAlign: "left",
        zIndex,
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
  );
}
