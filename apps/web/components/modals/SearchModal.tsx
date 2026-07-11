import { SEARCH_PLACEHOLDER } from "@/lib/chat";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
}

function SearchGlyph() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--t3)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
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
        background: MODAL_BACKDROP,
        backdropFilter: MODAL_BLUR,
        zIndex: Z.modal,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: 120,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 540,
          background: "var(--bg-sf)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          boxShadow: "0 24px 64px rgba(0,0,0,.7)",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "15px 16px" }}>
          <SearchGlyph />
          <input
            placeholder={SEARCH_PLACEHOLDER}
            style={{ flex: 1, background: "transparent", border: 0, outline: 0, color: "var(--t1)", fontSize: 16, fontFamily: "inherit", letterSpacing: "0em" }}
          />
          <button
            onClick={onClose}
            aria-label="Close search"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t2b)", cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}
          >
            ESC
          </button>
        </div>
        <div style={{ borderTop: "1px solid var(--bd)", padding: "13px 16px", fontSize: 12, color: "var(--tm)" }}>
          Semantic AI search — finds what&apos;s actually inside your photos &amp; videos, not just filenames
        </div>
      </div>
    </div>
  );
}
