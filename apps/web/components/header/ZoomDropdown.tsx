import { CheckIcon, FitIcon } from "@/components/icons/icons";

const DEFAULT_PRESETS = [50, 75, 100, 125, 150, 200];
/** Map view's Leaflet zoom is pinned to 100%–200% (world-fit up to 2x). */
export const MAP_ZOOM_PRESETS = [100, 125, 150, 175, 200];

interface ZoomDropdownProps {
  open: boolean;
  zoomPct: string;
  onClose: () => void;
  onSelectPct: (pct: number) => void;
  onFit: () => void;
  presets?: number[];
}

export default function ZoomDropdown({
  open,
  zoomPct,
  onClose,
  onSelectPct,
  onFit,
  presets = DEFAULT_PRESETS,
}: ZoomDropdownProps) {
  if (!open) return null;
  const curPct = parseInt(zoomPct, 10);
  return (
    <>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 48 }} />
      <div
        style={{
          position: "absolute",
          top: 46,
          right: 96,
          width: 150,
          background: "rgba(18,18,18,.97)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          backdropFilter: "blur(20px)",
          boxShadow: "0 20px 60px rgba(0,0,0,.7)",
          zIndex: 49,
          padding: 6,
        }}
      >
        {presets.map((pct) => (
          <button
            key={pct}
            onClick={() => onSelectPct(pct)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              padding: "7px 10px",
              background: "transparent",
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 12.5,
              color: "var(--t1)",
            }}
          >
            <span>{pct}%</span>
            {curPct === pct && <CheckIcon width={12} height={12} stroke="var(--ac)" strokeWidth={2.4} />}
          </button>
        ))}
        <div style={{ height: 1, background: "var(--bd)", margin: "4px 0" }} />
        <button
          onClick={() => {
            onFit();
            onClose();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "7px 10px",
            background: "transparent",
            border: 0,
            borderRadius: 2,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12.5,
            color: "var(--t2)",
          }}
        >
          <FitIcon width={12} height={12} />
          Zoom to fit
        </button>
      </div>
    </>
  );
}
