import type { ChatMessage } from "@/types";
import { SparkleIcon, CloseIcon } from "@/components/icons/icons";

interface ChatPanelProps {
  open: boolean;
  msgs: ChatMessage[];
  input: string;
  onClose: () => void;
  onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (text?: string) => void;
}

const SUGGESTIONS = [
  "Find photos with medical workers",
  "Generate captions for unprocessed photos",
  "Which locations have the most photos?",
  "Group photos by visual theme",
];

function SendIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22 11 13 2 9z" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="var(--tm)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function ChatPanel({ open, msgs, input, onClose, onInput, onKey, onSend }: ChatPanelProps) {
  if (!open) return null;
  const showSug = msgs.length <= 1;

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        right: 0,
        bottom: 0,
        width: 320,
        background: "var(--bg-sf)",
        borderLeft: "1px solid var(--bd)",
        display: "flex",
        flexDirection: "column",
        zIndex: 37,
        boxShadow: "-8px 0 32px rgba(0,0,0,.35)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 13px 11px", borderBottom: "1px solid var(--bd)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "flex", width: 27, height: 27, alignItems: "center", justifyContent: "center", borderRadius: 2, background: "color-mix(in srgb,var(--ac) 18%,transparent)" }}>
            <SparkleIcon width={13} height={13} stroke="var(--ac)" strokeWidth={1.7} />
          </span>
          <span style={{ fontSize: 13, fontWeight: 400, color: "var(--t1)" }}>AI Assistant</span>
          <span style={{ height: 18, padding: "0 7px", borderRadius: 2, background: "var(--bg-el)", fontSize: 10, color: "var(--tm)", display: "inline-flex", alignItems: "center" }}>
            Gemini
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t2b)", cursor: "pointer" }}
        >
          <CloseIcon />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
        {msgs.map((m, i) => {
          const isAI = m.role === "assistant";
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              {isAI && (
                <span
                  style={{
                    display: "flex",
                    width: 22,
                    height: 22,
                    flex: "0 0 auto",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 2,
                    background: "color-mix(in srgb,var(--ac) 18%,transparent)",
                    marginTop: 1,
                  }}
                >
                  <SparkleIcon width={11} height={11} stroke="var(--ac)" strokeWidth={1.7} />
                </span>
              )}
              <div
                style={{
                  maxWidth: isAI ? 230 : 215,
                  padding: "9px 11px",
                  borderRadius: isAI ? "2px 3px 3px 3px" : "3px 2px 3px 3px",
                  background: isAI ? "var(--bg-el)" : "var(--ac)",
                  fontSize: 12.5,
                  color: isAI ? "var(--t1)" : "#050505",
                  lineHeight: 1.5,
                  marginLeft: isAI ? 0 : "auto",
                }}
              >
                {m.text}
              </div>
            </div>
          );
        })}
        {showSug && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "var(--tm)", textTransform: "uppercase", letterSpacing: ".07em", paddingLeft: 30 }}>
              Try asking
            </span>
            {SUGGESTIONS.map((sg) => (
              <button
                key={sg}
                onClick={() => onSend(sg)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "7px 10px 7px 30px",
                  background: "var(--bg-in)",
                  border: "1px solid var(--bd)",
                  borderRadius: 2,
                  color: "var(--t2)",
                  fontSize: 12,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                  width: "100%",
                }}
              >
                <ChevronRight />
                {sg}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "9px 11px 11px", borderTop: "1px solid var(--bd)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 7, background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 2, padding: "7px 7px 7px 11px" }}>
          <textarea
            placeholder="Ask about your archive…"
            value={input}
            onChange={onInput}
            onKeyDown={onKey}
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: 0,
              color: "var(--t1)",
              fontSize: 12.5,
              resize: "none",
              minHeight: 34,
              maxHeight: 110,
              lineHeight: 1.5,
              padding: 0,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={() => onSend()}
            aria-label="Send message"
            style={{ display: "flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", border: 0, borderRadius: 2, background: "var(--ac)", color: "#050505", cursor: "pointer", flex: "0 0 auto" }}
          >
            <SendIcon />
          </button>
        </div>
        <div style={{ fontSize: 10, color: "var(--tm)", textAlign: "center", marginTop: 6 }}>
          Powered by Gemini Flash · 12 files in context
        </div>
      </div>
    </div>
  );
}
