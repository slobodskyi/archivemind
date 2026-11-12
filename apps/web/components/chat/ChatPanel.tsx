import { useState } from "react";
import type { LabelNames } from "@archivemind/shared";
import type { ChatAction, ChatMessage, ChatOffer, ChatResult } from "@/types";
import type { ResultActions } from "@/lib/assistant";
import { CHAT_FOOTNOTE, CHAT_PLACEHOLDER, CHAT_TITLE } from "@/lib/chat";
import { LABEL_COLORS } from "@/lib/labels";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
import { SparkleIcon, CloseIcon } from "@/components/icons/icons";

interface ChatPanelProps {
  open: boolean;
  msgs: ChatMessage[];
  input: string;
  onClose: () => void;
  onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSend: (text?: string) => void;
  onOpenResult: (id: string) => void;
  /** Run something the assistant offered. The panel only ever describes an
   *  action; hooks/useAssistant decides how it runs (at once, or through the
   *  dialog that already owns it). */
  onAction: (action: ChatAction) => void;
  /** Which actions a set of result ids gets on the canvas as it is now. */
  actionsFor: (resultIds: readonly string[]) => ResultActions;
  /** What to offer before anything has been typed. */
  starter: { note: string | null; offers: ChatOffer[] };
  labelNames: LabelNames;
}

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

function ThumbGrid({ rows, dim, onOpenResult }: { rows: ChatResult[]; dim?: boolean; onOpenResult: (id: string) => void }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8, opacity: dim ? 0.55 : 1 }}>
      {rows.slice(0, 12).map((r) => (
        <button
          key={r.assetId}
          onClick={() => onOpenResult(r.assetId)}
          title={`${r.filename}${r.matchedTags.length ? ` · ${r.matchedTags.join(", ")}` : ""}${r.matchedPlace ? ` · ${r.matchedPlace}` : ""}${r.matchedText ? " · in description" : ""}`}
          aria-label={`Open ${r.filename}`}
          style={{
            width: 38,
            height: 38,
            padding: 0,
            // A term-matched thumb wears the accent — the "why it matched"
            // signal has to survive touch screens, not just hover tooltips.
            border: `1px solid ${r.matchedTags.length || r.matchedPlace || r.matchedText ? "var(--ac)" : "var(--bd)"}`,
            borderRadius: 2,
            background: "var(--bg-in)",
            cursor: "pointer",
            overflow: "hidden",
          }}
        >
          {r.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.src} alt={r.filename} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <span style={{ fontSize: 8, color: "var(--tm)" }}>…</span>
          )}
        </button>
      ))}
      {rows.length > 12 && <span style={{ alignSelf: "center", fontSize: 10, color: "var(--tm)" }}>+{rows.length - 12}</span>}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  height: 24,
  padding: "0 10px",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "var(--bg-in)",
  color: "var(--t2)",
  fontSize: 11,
  fontFamily: "inherit",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const aiBtn: React.CSSProperties = {
  ...smallBtn,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "1px solid color-mix(in srgb,var(--ai) 55%,transparent)",
  background: "color-mix(in srgb,var(--ai) 12%,transparent)",
  color: "var(--ai)",
};

const menuItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  width: "100%",
  minHeight: 26,
  padding: "4px 8px",
  border: 0,
  borderRadius: 2,
  background: "transparent",
  color: "var(--t2)",
  fontSize: 11.5,
  fontFamily: "inherit",
  textAlign: "left",
  cursor: "pointer",
};

const subPanel: React.CSSProperties = {
  marginTop: 5,
  padding: 3,
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "var(--bg-in)",
};

const fine: React.CSSProperties = { marginTop: 6, fontSize: 10.5, color: "var(--tm)", lineHeight: 1.4 };

/** A button the assistant put under its own message. Purple is the colour of
 *  every control that leads to the AI panel — it opens an estimate, not a run. */
function OfferButton({ offer, onAction }: { offer: ChatOffer; onAction: (action: ChatAction) => void }) {
  if (offer.tone === "ai") {
    return (
      <button type="button" onClick={() => onAction(offer.action)} style={aiBtn}>
        <SparkleIcon width={11} height={11} stroke="currentColor" strokeWidth={1.7} />
        {offer.label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onAction(offer.action)}
      style={{ ...smallBtn, ...(offer.tone === "danger" ? { color: "var(--red)" } : {}) }}
    >
      {offer.label}
    </button>
  );
}

type RowMenu = "board" | "label" | "more" | null;

/** Search hits split by tier (ADR 0029): strong ones ARE the answer; weak
 *  ones stay behind a toggle so "everything, reordered" reads as what it is.
 *
 *  Under them, the action row: what can be done with the answer without
 *  leaving the chat. It acts on the thumbs you can see — the strong tier, or
 *  everything once the distant ones are shown — narrowed to the photos this
 *  canvas draws, and it says so when that is fewer than the answer. Sub-menus
 *  open inline rather than as popovers: the panel is 320 px wide and clips. */
function ResultStrip({
  results,
  onOpenResult,
  onAction,
  actionsFor,
  labelNames,
}: {
  results: ChatResult[];
  onOpenResult: (id: string) => void;
  onAction: (action: ChatAction) => void;
  actionsFor: (resultIds: readonly string[]) => ResultActions;
  labelNames: LabelNames;
}) {
  const [showWeak, setShowWeak] = useState(false);
  const [menu, setMenu] = useState<RowMenu>(null);
  const strong = results.filter((r) => r.tier === "strong");
  const weak = results.filter((r) => r.tier === "weak");
  const scope = showWeak ? results : strong;
  const a = actionsFor(scope.map((r) => r.assetId));
  const ids = a.ids;
  const n = ids.length;

  const act = (action: ChatAction) => {
    setMenu(null);
    onAction(action);
  };
  const toggle = (m: Exclude<RowMenu, null>) => setMenu((cur) => (cur === m ? null : m));
  const chip = (m: Exclude<RowMenu, null>): React.CSSProperties =>
    menu === m ? { ...smallBtn, borderColor: "var(--bdh)", color: "var(--t1)" } : smallBtn;

  return (
    <>
      <ThumbGrid rows={strong} onOpenResult={onOpenResult} />
      {showWeak && <ThumbGrid rows={weak} dim onOpenResult={onOpenResult} />}
      {weak.length > 0 && (
        <button
          type="button"
          onClick={() => setShowWeak((v) => !v)}
          style={{ ...smallBtn, marginTop: 7, color: "var(--t2b)" }}
        >
          {showWeak ? "Hide" : "Show"} {weak.length} more distant
        </button>
      )}

      {n > 0 && (
        <div role="group" aria-label={`Actions for ${n} ${n === 1 ? "photo" : "photos"}`}>
          <div style={{ ...fine, marginTop: 9, textTransform: "uppercase", letterSpacing: ".07em", fontSize: 9.5 }}>
            With {n === 1 ? "this photo" : `these ${n}`}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
            <button type="button" onClick={() => act({ kind: "select", ids })} style={smallBtn}>
              Select
            </button>
            {a.boards && (
              <button type="button" aria-expanded={menu === "board"} onClick={() => toggle("board")} style={chip("board")}>
                Workspace ▾
              </button>
            )}
            <button type="button" aria-expanded={menu === "label"} onClick={() => toggle("label")} style={chip("label")}>
              Label ▾
            </button>
            {a.canShare && (
              <button type="button" onClick={() => act({ kind: "share", ids })} style={smallBtn}>
                Share…
              </button>
            )}
            <button type="button" onClick={() => act({ kind: "download", ids })} style={smallBtn}>
              Download…
            </button>
            <button type="button" aria-expanded={menu === "more"} onClick={() => toggle("more")} style={chip("more")}>
              More ▾
            </button>
          </div>

          {menu === "board" && a.boards && (
            <div style={subPanel}>
              {a.boards.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  disabled={b.missing === 0}
                  onClick={() => act({ kind: "add_to_board", ids, boardId: b.id })}
                  style={{ ...menuItem, ...(b.missing === 0 ? { cursor: "default", color: "var(--tm)" } : {}) }}
                >
                  <span aria-hidden="true" style={{ width: 8, height: 8, flex: "0 0 auto", borderRadius: "50%", background: LABEL_COLORS[b.color] }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                  <span style={{ fontSize: 10, color: "var(--tm)" }}>{b.missing === 0 ? "all in" : `+${b.missing}`}</span>
                </button>
              ))}
              <button type="button" onClick={() => act({ kind: "add_to_board", ids, boardId: null })} style={menuItem}>
                <span aria-hidden="true" style={{ width: 8, flex: "0 0 auto", textAlign: "center", color: "var(--tm)" }}>＋</span>
                New workspace with {n === 1 ? "it" : `these ${n}`}
              </button>
            </div>
          )}

          {menu === "label" && (
            <div style={subPanel}>
              <LabelSwatchRow
                names={labelNames}
                current={null}
                onPick={(label) => act({ kind: "label", ids, label })}
                onDismiss={() => setMenu(null)}
              />
            </div>
          )}

          {menu === "more" && (
            <div style={subPanel}>
              <button type="button" onClick={() => act({ kind: "caption", ids })} style={{ ...menuItem, color: "var(--ai)" }}>
                <SparkleIcon width={11} height={11} stroke="currentColor" strokeWidth={1.7} />
                Write captions…
              </button>
              <button type="button" onClick={() => act({ kind: "view", ids })} style={menuItem}>
                Open full screen
              </button>
              {a.canTrash && (
                <button type="button" onClick={() => act({ kind: "trash", ids })} style={{ ...menuItem, color: "var(--red)" }}>
                  Move to Trash…
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {a.outside > 0 && (
        <div style={fine}>
          {n === 0
            ? `${a.outside === 1 ? "This result is" : "These results are"} outside this view.`
            : `${a.outside} more ${a.outside === 1 ? "is" : "are"} outside this view.`}
        </div>
      )}
      {a.bringIn && (
        <button
          type="button"
          onClick={() => act({ kind: "add_to_board", ids: a.bringIn?.ids ?? [], boardId: a.bringIn?.boardId ?? null })}
          style={{ ...smallBtn, marginTop: 7, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          Add {a.bringIn.ids.length} to {a.bringIn.name}
        </button>
      )}
    </>
  );
}

export default function ChatPanel({
  open,
  msgs,
  input,
  onClose,
  onInput,
  onKey,
  onSend,
  onOpenResult,
  onAction,
  actionsFor,
  starter,
  labelNames,
}: ChatPanelProps) {
  if (!open) return null;
  const showSug = msgs.length <= 1;
  const starterAi = starter.offers.filter((o) => o.tone === "ai");
  const starterRows = starter.offers.filter((o) => o.tone !== "ai");

  return (
    <div
      style={{
        position: "absolute",
        top: "var(--hdr)",
        right: 0,
        bottom: 0,
        width: "min(320px, 100vw)",
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
          <span style={{ fontSize: 13, fontWeight: 400, color: "var(--t1)" }}>{CHAT_TITLE}</span>
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
        {msgs.map((m) => {
          const isAI = m.role === "assistant";
          return (
            <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
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
                  minWidth: 0,
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
                {m.results && m.results.length > 0 && (
                  <ResultStrip
                    results={m.results}
                    onOpenResult={onOpenResult}
                    onAction={onAction}
                    actionsFor={actionsFor}
                    labelNames={labelNames}
                  />
                )}
                {m.note && (
                  <div style={{ ...fine, marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--bd)", fontSize: 11, color: "var(--t2)" }}>
                    {m.note}
                  </div>
                )}
                {m.offers && m.offers.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: m.note ? 6 : 8 }}>
                    {m.offers.map((o) => (
                      <OfferButton key={o.label} offer={o} onAction={onAction} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {showSug && (starter.note || starter.offers.length > 0) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 4 }}>
            {starter.note && <span style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.45, paddingLeft: 30 }}>{starter.note}</span>}
            {starterAi.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, paddingLeft: 30 }}>
                {starterAi.map((o) => (
                  <OfferButton key={o.label} offer={o} onAction={onAction} />
                ))}
              </div>
            )}
            {starterRows.length > 0 && (
              <span style={{ fontSize: 10, color: "var(--tm)", textTransform: "uppercase", letterSpacing: ".07em", paddingLeft: 30, marginTop: 3 }}>
                Try
              </span>
            )}
            {starterRows.map((o) => (
              <button
                key={o.label}
                onClick={() => onAction(o.action)}
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
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: "9px 11px 11px", borderTop: "1px solid var(--bd)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 7, background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 2, padding: "7px 7px 7px 11px" }}>
          <textarea
            placeholder={CHAT_PLACEHOLDER}
            aria-label="Message the assistant"
            maxLength={500}
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
        <div style={{ fontSize: 10, color: "var(--tm)", textAlign: "center", marginTop: 6 }}>{CHAT_FOOTNOTE}</div>
      </div>
    </div>
  );
}
