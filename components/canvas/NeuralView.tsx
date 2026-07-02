import type { Photo } from "@/types";
import type { NeuralLayout } from "@/lib/layout";
import PhotoTile from "./PhotoTile";

interface NeuralViewProps {
  layout: NeuralLayout;
  photos: Photo[];
  selectedIds: Set<string>;
  hoveredId: string | null;
  onNodeDown: (
    e: React.PointerEvent,
    kind: "hub" | "folder",
    key: string,
    origCenter: { x: number; y: number },
  ) => void;
  onCardDown: (e: React.PointerEvent, id: string) => void;
  setHover: (id: string | null) => void;
  openDrawer: (id: string) => void;
  deletePhoto: (id: string) => void;
}

export default function NeuralView({
  layout,
  photos,
  selectedIds,
  hoveredId,
  onNodeDown,
  onCardDown,
  setHover,
  openDrawer,
  deletePhoto,
}: NeuralViewProps) {
  const { pos, overlay } = layout;

  return (
    <>
      <svg
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: 3200,
          height: 1700,
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        {overlay.hubEdges.map((e, i) => (
          <path key={`he${i}`} d={e.d} stroke={e.stroke} strokeWidth={e.w} strokeOpacity={e.op} strokeLinecap="round" fill="none" />
        ))}
        {overlay.folderEdges.map((e, i) => (
          <path key={`fe${i}`} d={e.d} stroke={e.stroke} strokeWidth={e.w} strokeOpacity={e.op} strokeLinecap="round" fill="none" />
        ))}
        {overlay.looseEdges.map((e, i) => (
          <path key={`le${i}`} d={e.d} stroke={e.stroke} strokeWidth={e.w} strokeOpacity={e.op} strokeLinecap="round" fill="none" />
        ))}
      </svg>

      {/* LEVEL 1 — source hubs */}
      {overlay.hubs.map((hub) => (
        <div
          key={hub.key}
          onPointerDown={(e) => onNodeDown(e, "hub", hub.key, { x: hub.x, y: hub.y })}
          style={{
            position: "absolute",
            left: hub.x,
            top: hub.y,
            transform: "translate(-50%,-50%)",
            zIndex: 28,
            cursor: "grab",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
            <div
              style={{
                width: 74,
                height: 74,
                borderRadius: 999,
                background: "var(--bg-el)",
                border: `2px solid ${hub.color}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: `0 0 0 14px ${hub.glow},0 0 46px ${hub.color}`,
                animation: "amPulse 2.8s ease-in-out infinite",
              }}
            >
              <span style={{ fontSize: 17, fontWeight: 700, color: hub.color, letterSpacing: "0.03em", fontFamily: "inherit" }}>
                {hub.abbr}
              </span>
            </div>
            <div
              style={{
                background: "rgba(6,6,6,.96)",
                border: "1px solid rgba(255,255,255,.09)",
                padding: "5px 12px",
                borderRadius: 2,
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 700, color: hub.color, letterSpacing: "0.06em", whiteSpace: "nowrap", fontFamily: "inherit" }}>
                {hub.label}
              </div>
              <div style={{ fontSize: 9.5, color: "var(--t3)", textAlign: "center", letterSpacing: "0.04em", marginTop: 2 }}>
                {hub.count} FILES
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* LEVEL 2 — folders */}
      {overlay.folders.map((fd) => (
        <div
          key={fd.key}
          onPointerDown={(e) => onNodeDown(e, "folder", fd.key, { x: fd.x + 54, y: fd.y + 40 })}
          style={{
            position: "absolute",
            left: fd.x,
            top: fd.y,
            width: 108,
            zIndex: 24,
            cursor: "grab",
            filter: `drop-shadow(0 12px 30px ${fd.shadow})`,
          }}
        >
          <div
            style={{
              height: 15,
              background: fd.tabBg,
              borderRadius: "2px 2px 0 0",
              width: 56,
              display: "flex",
              alignItems: "center",
              padding: "0 8px",
            }}
          >
            <span style={{ fontSize: 7.5, fontWeight: 700, color: "rgba(0,0,0,.55)", letterSpacing: ".06em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden" }}>
              {fd.source}
            </span>
          </div>
          <div
            style={{
              background: fd.bg,
              borderRadius: "0 2px 2px 2px",
              padding: "8px 10px 9px",
              minHeight: 64,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <span style={{ fontSize: 26, fontWeight: 800, color: "rgba(0,0,0,.72)", lineHeight: 1 }}>{fd.count}</span>
            <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(0,0,0,.48)", letterSpacing: ".05em", textTransform: "uppercase", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {fd.label}
            </span>
          </div>
        </div>
      ))}

      {/* LEVEL 3 — file previews */}
      {photos.map((p) => {
        const tp = pos[p.id];
        if (!tp) return null;
        return (
          <PhotoTile
            key={p.id}
            id={p.id}
            seed={p.seed}
            natW={p.w}
            natH={p.h}
            pos={tp}
            selected={selectedIds.has(p.id)}
            hovered={hoveredId === p.id}
            onDown={(e) => onCardDown(e, p.id)}
            onEnter={() => setHover(p.id)}
            onLeave={() => setHover(null)}
            onOpen={(e) => {
              e.stopPropagation();
              openDrawer(p.id);
            }}
            onDelete={(e) => {
              e.stopPropagation();
              deletePhoto(p.id);
            }}
          />
        );
      })}
    </>
  );
}
