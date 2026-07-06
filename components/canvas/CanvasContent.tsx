import type { Photo, ViewMode } from "@/types";
import type { Layout } from "@/lib/layout";
import { statusMeta } from "@/lib/format";
import PhotoTile from "./PhotoTile";

interface CanvasContentProps {
  view: ViewMode;
  layout: Layout;
  photos: Photo[];
  selectedIds: Set<string>;
  bookmarks: Set<string>;
  hoveredId: string | null;
  tileTransition: string;
  onCardDown: (e: React.PointerEvent, id: string) => void;
  onHoverEnter: (id: string) => void;
  onHoverLeave: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onBookmark: (id: string) => void;
}

export default function CanvasContent({
  view,
  layout,
  photos,
  selectedIds,
  bookmarks,
  hoveredId,
  tileTransition,
  onCardDown,
  onHoverEnter,
  onHoverLeave,
  onOpen,
  onDelete,
  onBookmark,
}: CanvasContentProps) {
  const { pos, overlay } = layout;

  return (
    <>
      {overlay.isTimeline && (
        <>
          <div style={{ position: "absolute", left: overlay.axisX0, top: 302, width: overlay.axisW, height: 1, background: "rgba(255,255,255,0.12)" }} />
          {overlay.tlTicks?.map((t, i) => (
            <div key={i}>
              <div style={{ position: "absolute", left: t.x, top: 128, width: 1, height: 660, background: "rgba(255,255,255,0.06)" }} />
              <div style={{ position: "absolute", left: t.x, top: 100, transform: "translateX(-50%)", fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                {t.label}
              </div>
            </div>
          ))}
        </>
      )}

      {overlay.isMap && (
        <>
          <div
            style={{
              position: "absolute",
              left: overlay.mapX,
              top: overlay.mapY,
              width: overlay.mapW,
              height: overlay.mapH,
              borderRadius: 18,
              background: "#0d1014",
              border: "1px solid var(--border-subtle)",
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)",
              backgroundSize: "46px 46px",
            }}
          />
          <svg style={{ position: "absolute", left: 0, top: 0, width: 1700, height: 1100, overflow: "visible", pointerEvents: "none" }}>
            {overlay.lands?.map((l, i) => (
              <polygon key={i} points={l.points} fill={l.fill} stroke={l.stroke} strokeWidth={1.5} strokeLinejoin="round" />
            ))}
            {overlay.edges?.map((e, i) => (
              <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={e.stroke} strokeWidth={e.w} strokeOpacity={e.op} strokeLinecap="round" />
            ))}
          </svg>
          {overlay.regions?.map((r, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: r.x,
                top: r.y,
                transform: "translate(-50%,-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                pointerEvents: "none",
                zIndex: 24,
              }}
            >
              <div style={{ width: 11, height: 11, borderRadius: 999, background: r.color, boxShadow: `0 0 14px ${r.color}` }} />
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999, background: "rgba(18,18,18,.86)", border: "1px solid var(--border-subtle)", backdropFilter: "blur(6px)", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-primary)" }}>{r.label}</span>
                <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{r.count}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {overlay.isSmart && (
        <>
          <svg style={{ position: "absolute", left: 0, top: 0, width: 1700, height: 1200, overflow: "visible", pointerEvents: "none" }}>
            {overlay.edges?.map((e, i) => (
              <line
                key={i}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={e.stroke}
                strokeWidth={e.w}
                strokeOpacity={e.op}
                strokeDasharray={e.dash}
                strokeLinecap="round"
                style={{ animation: e.anim }}
              />
            ))}
          </svg>
          {overlay.hubs?.map((h, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: h.x,
                top: h.y,
                transform: "translate(-50%,-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 9,
                pointerEvents: "none",
                zIndex: 25,
              }}
            >
              <div style={{ width: 16, height: 16, borderRadius: 999, background: h.color, boxShadow: `0 0 0 7px ${h.glow}, 0 0 30px ${h.color}` }} />
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 12px", borderRadius: 999, background: "rgba(18,18,18,.9)", border: "1px solid var(--border-subtle)", backdropFilter: "blur(8px)", whiteSpace: "nowrap" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>{h.label}</span>
                <span style={{ fontSize: 10, color: "var(--text-tertiary)" }}>{h.count}</span>
              </div>
            </div>
          ))}
        </>
      )}

      {photos.map((p) => {
        const tp = pos[p.id];
        if (!tp) return null;
        const showChip = p.processed && tp.w >= 150 && view !== "map" && view !== "smart";
        return (
          <PhotoTile
            key={p.id}
            seed={p.seed}
            pos={tp}
            selected={selectedIds.has(p.id)}
            hovered={hoveredId === p.id}
            bookmarked={bookmarks.has(p.id)}
            anim={p.anim}
            transition={tileTransition}
            showChip={showChip}
            chip={p.chip}
            dotColor={statusMeta(p.status).color}
            onDown={(e) => onCardDown(e, p.id)}
            onEnter={() => onHoverEnter(p.id)}
            onLeave={onHoverLeave}
            onOpen={(e) => {
              e.stopPropagation();
              onOpen(p.id);
            }}
            onDelete={(e) => {
              e.stopPropagation();
              onDelete(p.id);
            }}
            onBookmark={(e) => {
              e.stopPropagation();
              onBookmark(p.id);
            }}
          />
        );
      })}
    </>
  );
}
