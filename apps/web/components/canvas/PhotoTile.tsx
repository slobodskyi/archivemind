import type { AssetLabel } from "@archivemind/shared";
import type { CanvasUploadStage } from "@/types";
import type { TilePos } from "@/lib/layout";
import { LABEL_COLORS } from "@/lib/labels";
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
  /** Persistent stacking delta ("Bring to front / Send to back"), added to the
   *  tile's resting z-index so its layer order survives across renders. */
  z?: number;
  /** Faded back when another cloud is focused (a label was clicked). */
  dimmed?: boolean;
  onDown?: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onEnter?: () => void;
  onLeave?: () => void;
  onOpen?: () => void;
  /** Right-click on the tile — opens the grid context menu at the cursor. */
  onContext?: (e: React.MouseEvent) => void;
  /** Shown as a small hover button, top-right of the tile — every view that
   *  renders a PhotoTile gets file deletion for free (issue: delete on any view). */
  onDelete?: (e: React.MouseEvent) => void;
  /** AI state, shown as a badge in the tile's top-left corner. `analyzed`
   *  mirrors `photo.processed` (the worker's ai_processed_at). Without this the
   *  only way to tell an analyzed photo from a raw one was to open the drawer
   *  and read the status chip. */
  analyzed?: boolean;
  /** This tile is covered by the AI job currently running. */
  aiBusy?: boolean;
  /** Click on the badge — analyzes just this photo. Omitted (badge becomes a
   *  plain indicator) for mock rows and non-interactive surfaces. */
  onAnalyze?: (e: React.MouseEvent) => void;
  /** Colour label, drawn as a dot before the filename — where Finder puts it,
   *  and the one spot on this tile that is neither corner: top-left is the AI
   *  badge and top-right is Delete. */
  label?: AssetLabel | null;
  labelName?: string;
  /** Start pulling a wire out of this tile (ADR 0048) — the port renders only
   *  when this is provided (neural view, open Workspace). */
  onEdgeStart?: (e: React.PointerEvent) => void;
  /** An in-flight wire is hovering this tile — draw the drop ring. */
  edgeDropTarget?: boolean;
}

/** Filled = analyzed, hollow = not. Deliberately the same sparkle used by every
 *  other AI affordance in the app, so the badge reads as "AI" at 14px. */
function AiBadgeGlyph({ filled }: { filled: boolean }) {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />
    </svg>
  );
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
  z = 0,
  dimmed,
  onDown,
  onEnter,
  onLeave,
  onOpen,
  onContext,
  onDelete,
  analyzed = false,
  aiBusy = false,
  onAnalyze,
  label = null,
  labelName,
  onEdgeStart,
  edgeDropTarget = false,
}: PhotoTileProps) {
  // The layer-order delta (`z`) shifts the whole resting band, so a tile brought
  // to front stays above its neighbours even when one of them is hovered.
  const zIndex = (hovered ? 30 : selected ? 12 : 2) + z;
  const status = stage === "ready" ? "" : `, ${STAGE_LABEL[stage]}`;
  const posTransition = animating ? "left .45s cubic-bezier(.4,0,.2,1), top .45s cubic-bezier(.4,0,.2,1)" : "";
  // A tile with no image yet, while still being uploaded/processed, shows a
  // loading shimmer instead of a bare tint — a static "Preview unavailable"
  // (stage ready) or a failed tile must NOT shimmer forever.
  const loading = stage === "uploading" || stage === "processing";

  return (
    <div
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        width: pos.w,
        zIndex,
        opacity: dimmed ? 0.22 : 1,
        transition: [posTransition, "opacity .2s ease"].filter(Boolean).join(", "),
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onContextMenu={interactive ? onContext : undefined}
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
          // Selection is drawn by the single outer ring above; the tile's own
          // border stays neutral so a selected tile shows one outline, not two
          // concentric accent lines.
          border: `1px solid ${stage === "error" ? "var(--red)" : "var(--bd)"}`,
          borderRadius: 3,
          background: "var(--bg-in)",
          backgroundImage: src ? `url(${src})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
          boxShadow: hovered ? "0 12px 28px rgba(0,0,0,.42)" : "none",
        }}
      >
        {!src && loading && (
          <span aria-hidden="true" className="am-tile-shimmer" style={{ position: "absolute", inset: 0 }} />
        )}
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
        {loading && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              overflow: "hidden",
              background: "rgba(255,255,255,.08)",
            }}
          >
            <span
              className="am-progress-indeterminate"
              style={{ position: "absolute", top: 0, bottom: 0, width: "35%", background: "var(--ac)" }}
            />
          </span>
        )}
      </span>
      <span
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 6,
          overflow: "hidden",
          color: stage === "error" ? "var(--red)" : "var(--t2)",
          fontSize: 10.5,
          lineHeight: 1.3,
        }}
      >
        {label && (
          <span
            // Not aria-hidden: the colour is the only carrier of this meaning,
            // so the name has to reach a screen reader some other way.
            role="img"
            aria-label={labelName ?? label}
            title={labelName ?? label}
            style={{
              width: 6,
              height: 6,
              flex: "0 0 auto",
              borderRadius: "50%",
              background: LABEL_COLORS[label],
            }}
          />
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filename}</span>
      </span>
    </button>
    {/* AI badge — always on (not hover-only) for ingested tiles: the point is
        to scan a canvas and see at a glance what still needs analysis, and a
        badge that appears only under the cursor can't do that. Absence of a
        badge would be ambiguous with "analyzed", so both states render. */}
    {stage === "ready" && (analyzed || onAnalyze || aiBusy) && (
      <button
        type="button"
        disabled={!onAnalyze || aiBusy || analyzed}
        aria-label={aiBusy ? `${filename}: AI running` : analyzed ? `${filename}: analyzed by AI` : `Analyze ${filename} with AI`}
        title={aiBusy ? "AI is working on this photo…" : analyzed ? "Analyzed — tags, facts and search are ready" : "Not analyzed yet — click to analyze with AI"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onAnalyze}
        className={aiBusy ? "am-ai-badge-busy" : undefined}
        style={{
          position: "absolute",
          top: 4,
          left: 4,
          display: "flex",
          width: 20,
          height: 20,
          alignItems: "center",
          justifyContent: "center",
          border: `1px solid ${aiBusy || analyzed ? "color-mix(in srgb,var(--ac) 55%,transparent)" : "rgba(255,255,255,.16)"}`,
          borderRadius: 2,
          background: aiBusy || analyzed ? "color-mix(in srgb,var(--ac) 20%,rgba(10,10,10,.8))" : "rgba(10,10,10,.65)",
          color: aiBusy || analyzed ? "var(--ac)" : "rgba(255,255,255,.55)",
          cursor: onAnalyze && !analyzed && !aiBusy ? "pointer" : "default",
          opacity: analyzed && !hovered ? 0.75 : 1,
          transition: "opacity .15s, color .15s, background .15s",
          zIndex: 5,
        }}
      >
        <AiBadgeGlyph filled={analyzed || aiBusy} />
      </button>
    )}
    {/* Shown on hover OR selection. Hover-only made this touch-only-unreachable:
        a finger produces no hover, so on a tablet the tile's own delete simply
        did not exist. Selection is the touch equivalent — one tap arms it. */}
    {interactive && onDelete && (hovered || selected) && (
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
    {/* The wire port (ADR 0048): drag out to connect this photo to another, to
        a note, or to empty canvas. Same reachability rule as Delete above —
        hover OR selection, so a tablet can arm it with a tap. Fully OUTSIDE
        the frame (it must never sit on the photograph), joined to it by a
        short stem; the stem's invisible hover bridge is what keeps `hovered`
        alive while the pointer crosses the gap — without it the port unmounts
        before it can be reached. */}
    {interactive && onEdgeStart && (hovered || selected || edgeDropTarget) && (
      <>
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            right: -9,
            width: 9,
            height: 22,
            display: "flex",
            alignItems: "center",
            transform: "translateY(-50%)",
            zIndex: 6,
          }}
        >
          <span style={{ width: "100%", height: 1.5, background: "color-mix(in srgb,var(--ac) 55%,transparent)" }} />
        </span>
        <button
          type="button"
          aria-label={`Connect ${filename}`}
          title="Drag to connect — or click to add a note"
          data-edge-port=""
          onPointerDown={onEdgeStart}
          style={{
            position: "absolute",
            top: "50%",
            right: -29,
            display: "flex",
            width: 20,
            height: 20,
            alignItems: "center",
            justifyContent: "center",
            transform: "translateY(-50%)",
            border: "1px solid color-mix(in srgb,var(--ac) 55%,transparent)",
            borderRadius: 999,
            background: "rgba(10,10,10,.85)",
            color: "var(--ac)",
            cursor: "crosshair",
            zIndex: 6,
          }}
        >
          <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </button>
      </>
    )}
    {/* An in-flight wire is over this tile — the drop ring. */}
    {edgeDropTarget && (
      <span
        aria-hidden="true"
        style={{ position: "absolute", inset: -3, border: "2px solid var(--ac)", borderRadius: 4, pointerEvents: "none", zIndex: 6 }}
      />
    )}
    </div>
  );
}
