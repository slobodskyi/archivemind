const SEARCH_PLACEHOLDER = 'Search "medics", "rubble", "night", "Solomianskyi"…';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

function SearchGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={11} cy={11} r={7} />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export default function SearchModal({ open, onClose }: SearchModalProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        backdropFilter: "blur(2px)",
        zIndex: 58,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: 130,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-hover)",
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(0,0,0,.7)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "16px 18px" }}>
          <SearchGlyph />
          <input
            placeholder={SEARCH_PLACEHOLDER}
            style={{ flex: 1, background: "transparent", border: 0, outline: 0, color: "var(--text-primary)", fontSize: 16, fontFamily: "inherit", letterSpacing: "-0.02em" }}
          />
          <button
            onClick={onClose}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, border: 0, background: "var(--bg-elevated)", borderRadius: 6, color: "var(--text-tertiary)", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}
          >
            ESC
          </button>
        </div>
        <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "14px 18px", fontSize: 12, color: "var(--text-muted)" }}>
          Search captions, tags, people, places across the archive…
        </div>
      </div>
    </div>
  );
}
