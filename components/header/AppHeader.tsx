import { ChevronDownIcon, ShareIcon } from "@/components/icons/icons";

interface AppHeaderProps {
  projLabel?: string;
  zoomPct?: string;
  onZoomReset?: () => void;
}

export default function AppHeader({
  projLabel = "All my files",
  zoomPct = "100%",
  onZoomReset,
}: AppHeaderProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 52,
        background: "var(--bg-nb)",
        borderBottom: "1px solid var(--bd)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px 0 66px",
        zIndex: 40,
      }}
    >
      <button
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 34,
          padding: "0 11px",
          background: "var(--bg-sf)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          color: "var(--t1)",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "inherit",
          cursor: "pointer",
          maxWidth: 250,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 2,
            flex: "0 0 auto",
          }}
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <span
              key={i}
              style={{ width: 5, height: 5, borderRadius: 1, background: "var(--t2)" }}
            />
          ))}
        </div>
        <span
          style={{
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        >
          {projLabel}
        </span>
        <ChevronDownIcon />
      </button>

      {/* View tabs (Neural/Timeline/Map/Sense) land here in Phase 2, once those views exist. */}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={onZoomReset}
          aria-label="Reset zoom to fit"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            height: 30,
            padding: "0 10px",
            background: "var(--bg-sf)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            color: "var(--t2)",
            fontSize: 12,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          {zoomPct}
          <ChevronDownIcon width={10} height={10} stroke="currentColor" />
        </button>
        <button
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: 30,
            padding: "0 12px",
            background: "transparent",
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            color: "var(--t1)",
            fontSize: 12,
            fontWeight: 500,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          <ShareIcon />
          SHARE
        </button>
        <button
          aria-label="Account menu"
          style={{
            width: 30,
            height: 30,
            borderRadius: 2,
            background: "var(--bg-el)",
            border: "1px solid var(--bdh)",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            fontFamily: "inherit",
            color: "var(--t1)",
          }}
        >
          AM
        </button>
      </div>
    </div>
  );
}
