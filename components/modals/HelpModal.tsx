import { HELP_FAQ } from "@/lib/chat";
import { CloseIcon, SparkleIcon } from "@/components/icons/icons";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  onSend: () => void;
}

function HelpGlyph() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--ac)" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={9} />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.5 1.5c0 1.5-2 2-2 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export default function HelpModal({ open, onClose, onSend }: HelpModalProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,.62)",
        backdropFilter: "blur(6px)",
        zIndex: 65,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 490, background: "var(--bg-sf)", border: "1px solid var(--bdh)", borderRadius: 2, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 15px", borderBottom: "1px solid var(--bd)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ display: "flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 2, background: "color-mix(in srgb,var(--ac) 18%,transparent)" }}>
              <HelpGlyph />
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)" }}>Help &amp; Support</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t3)", cursor: "pointer" }}
          >
            <CloseIcon />
          </button>
        </div>
        <div style={{ padding: "16px 20px 20px", overflowY: "auto", maxHeight: 520 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)", marginBottom: 13 }}>
            Frequently asked
          </div>
          {HELP_FAQ.map((q) => (
            <div key={q.q} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--bd)" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--t1)", marginBottom: 5 }}>{q.q}</div>
              <div style={{ fontSize: 12, color: "var(--t2)", lineHeight: 1.6 }}>{q.a}</div>
            </div>
          ))}
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)", margin: "18px 0 12px" }}>
            Contact support
          </div>
          <textarea
            placeholder="Describe your issue or question…"
            style={{
              width: "100%",
              minHeight: 90,
              resize: "none",
              background: "var(--bg-in)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              padding: "10px 12px",
              color: "var(--t1)",
              fontSize: 13,
              outline: 0,
              fontFamily: "inherit",
              letterSpacing: "inherit",
              lineHeight: 1.5,
            }}
          />
          <button
            onClick={onSend}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              width: "100%",
              height: 40,
              marginTop: 10,
              background: "var(--ac)",
              border: 0,
              borderRadius: 2,
              color: "#050505",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <SparkleIcon width={14} height={14} />
            Send ticket
          </button>
        </div>
      </div>
    </div>
  );
}
