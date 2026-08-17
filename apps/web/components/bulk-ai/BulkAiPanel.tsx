import { CheckIcon, CloseIcon, SparkleIcon, TagIcon } from "@/components/icons/icons";
import { planAiRun, type AiOps } from "@/lib/ai-ops";
import type { CaptionStyle, Language } from "@/types";

interface BulkAiPanelProps {
  show: boolean;
  idle: boolean;
  /** Selected asset ids — the panel plans the run over these, so its button
   *  text is derived from the very same call the click will make. */
  selectedIds: string[];
  thumbs: { src: string; ml: number }[];
  bulkOps: AiOps;
  bulkLangs: Language[];
  bulkStyle: CaptionStyle;
  proc: { active: boolean; label: string; pct: number };
  onClear: () => void;
  onToggleCaptions: () => void;
  onToggleTags: () => void;
  onToggleLang: (l: Language) => void;
  onSetStyle: (s: CaptionStyle) => void;
  onRun: () => void;
}

const LANGS: Language[] = ["EN", "UK", "RU"];
const STYLES: CaptionStyle[] = ["Social", "Agency", "Archival"];

interface OpCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  checked: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

function OpCard({ icon, title, subtitle, checked, onToggle, children }: OpCardProps) {
  const cardBd = checked ? "color-mix(in srgb,var(--ac) 35%,transparent)" : "var(--bd)";
  const cardBg = checked ? "color-mix(in srgb,var(--ac) 6%,transparent)" : "transparent";
  const iconBg = checked ? "color-mix(in srgb,var(--ac) 18%,transparent)" : "var(--bg-el)";
  const iconColor = checked ? "var(--ac)" : "var(--t2)";
  const titleColor = checked ? "var(--t1)" : "var(--t2)";
  const checkBg = checked ? "var(--ac)" : "transparent";
  const checkBd = checked ? "var(--ac)" : "var(--bdh)";

  return (
    <div style={{ border: `1px solid ${cardBd}`, borderRadius: 2, padding: "11px 12px", background: cardBg, transition: "all .15s" }}>
      <button
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0, textAlign: "left" }}
      >
        <span
          style={{
            display: "flex",
            width: 30,
            height: 30,
            flex: "0 0 auto",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 2,
            background: iconBg,
            color: iconColor,
            transition: "background .15s,color .15s",
          }}
        >
          {icon}
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 400, color: titleColor }}>{title}</span>
          <span style={{ fontSize: 11, color: "var(--t3)", display: "flex", alignItems: "center", gap: 4 }}>{subtitle}</span>
        </span>
        <span
          style={{
            display: "flex",
            width: 18,
            height: 18,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 2,
            background: checkBg,
            border: `1.5px solid ${checkBd}`,
            transition: "background .12s",
          }}
        >
          {checked && <CheckIcon />}
        </span>
      </button>
      {children}
    </div>
  );
}

/** Bulk AI over the current selection. Every control here now actually drives
 *  the job that runs — the captions checkbox, the language chips and the style
 *  toggle used to render above a button hardcoded to `analyze`, so choosing
 *  "Generate captions · UK · Archival" and pressing it produced tags and no
 *  caption. The CTA also names the work instead of always saying "Analyze". */
export default function BulkAiPanel({
  show,
  idle,
  selectedIds,
  thumbs,
  bulkOps,
  bulkLangs,
  bulkStyle,
  proc,
  onClear,
  onToggleCaptions,
  onToggleTags,
  onToggleLang,
  onSetStyle,
  onRun,
}: BulkAiPanelProps) {
  if (!show) return null;

  const count = selectedIds.length;
  const noun = count === 1 ? "photo" : "photos";
  // Same call the click makes, so the button cannot promise work the run won't
  // do — and `calls` is the real model-call count, not the old flat "~$0.01".
  const plan = planAiRun(selectedIds, bulkOps, bulkLangs, bulkStyle);
  const blocked = plan.blocked !== null;

  return (
    <div
      // Below 760px it spans the width instead of holding a fixed 430 (wider
      // than the phone it opens on) and sits higher, because the action bar it
      // has to clear wraps to two rows there.
      className="am-bulk-ai"
      style={{
        position: "absolute",
        // Clears the action bar (bottom:66), which now sits above the view switcher.
        bottom: 124,
        left: "50%",
        transform: "translateX(-50%)",
        width: 430,
        background: "var(--bg-sf)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        boxShadow: "0 16px 48px rgba(0,0,0,.6)",
        zIndex: 36,
        overflowY: "auto",
        maxHeight: "calc(100vh - 112px)",
      }}
    >
      {proc.active && (
        <div style={{ padding: "18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
            <SparkleIcon width={15} height={15} />
            <span style={{ fontSize: 13, color: "var(--t1)" }}>{proc.label}</span>
          </div>
          <div style={{ height: 5, borderRadius: 2, background: "var(--bg-in)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: "var(--ac)", width: `${proc.pct}%`, transition: "width .25s ease" }} />
          </div>
        </div>
      )}

      {idle && (
        <div style={{ padding: "14px 15px 15px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ display: "flex" }}>
                {thumbs.map((t, i) => (
                  <div
                    key={i}
                    style={{
                      width: 27,
                      height: 27,
                      borderRadius: 2,
                      backgroundImage: `url(${t.src})`,
                      backgroundSize: "cover",
                      border: "1.5px solid var(--bg-sf)",
                      marginLeft: t.ml,
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: 14, fontWeight: 400, color: "var(--t1)" }}>
                {count} {noun} selected
              </span>
            </div>
            <button
              onClick={onClear}
              aria-label="Clear selection"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t2b)", cursor: "pointer" }}
            >
              <CloseIcon />
            </button>
          </div>

          <div style={{ fontSize: 10, fontWeight: 400, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--tm)", marginBottom: 8 }}>
            AI operations
          </div>

          {/* Analyze sits first because it RUNS first — captions are written
              from the facts it finds. The old order (captions on top) read as
              two unrelated options while the CTA said "Analyze & caption". */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <OpCard
              icon={<TagIcon width={15} height={15} />}
              title="Analyze"
              subtitle="Tags · facts · searchable · 1 call per photo"
              checked={bulkOps.tags}
              onToggle={onToggleTags}
            />

            <OpCard
              icon={<SparkleIcon width={15} height={15} />}
              title="Generate captions"
              subtitle="1 call per photo per language"
              checked={bulkOps.captions}
              onToggle={onToggleCaptions}
            >
              {bulkOps.captions && (
                <div style={{ marginTop: 11, paddingLeft: 40, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--tm)", width: 48, flex: "0 0 auto" }}>Language</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {LANGS.map((l) => {
                        const active = bulkLangs.includes(l);
                        return (
                          <button
                            key={l}
                            onClick={() => onToggleLang(l)}
                            style={{
                              height: 24,
                              padding: "0 11px",
                              borderRadius: 2,
                              fontSize: 11,
                              fontWeight: 400,
                              fontFamily: "inherit",
                              cursor: "pointer",
                              background: active ? "color-mix(in srgb,var(--ac) 16%,transparent)" : "transparent",
                              color: active ? "var(--ac)" : "var(--t2)",
                              border: `1px solid ${active ? "color-mix(in srgb,var(--ac) 40%,transparent)" : "var(--bd)"}`,
                            }}
                          >
                            {l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--tm)", width: 48, flex: "0 0 auto" }}>Style</span>
                    <div style={{ display: "inline-flex", gap: 3, background: "var(--bg)", borderRadius: 2, padding: 2 }}>
                      {STYLES.map((st) => (
                        <button
                          key={st}
                          onClick={() => onSetStyle(st)}
                          style={{
                            height: 23,
                            padding: "0 12px",
                            borderRadius: 2,
                            fontSize: 11,
                            fontWeight: 400,
                            fontFamily: "inherit",
                            cursor: "pointer",
                            border: 0,
                            background: bulkStyle === st ? "var(--bg-el)" : "transparent",
                            color: bulkStyle === st ? "#fff" : "var(--t3)",
                          }}
                        >
                          {st}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </OpCard>
          </div>

          {/* Both are on by default; this explains why they're separable at all
              rather than leaving the user to guess what the split buys them. */}
          <div style={{ marginTop: 10, fontSize: 10.5, lineHeight: 1.45, color: "var(--t3)" }}>
            {bulkOps.tags && bulkOps.captions
              ? "Analysis runs first — captions are written from the facts it finds."
              : bulkOps.captions
                ? "Captioning only — cheaper for re-writing captions in another language."
                : "Analysis only — no caption text, but the photos become searchable."}
          </div>

          <button
            onClick={onRun}
            disabled={blocked}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              width: "100%",
              height: 40,
              marginTop: 13,
              background: blocked ? "var(--bg-el)" : "var(--ac)",
              border: blocked ? "1px solid var(--bd)" : 0,
              borderRadius: 2,
              color: blocked ? "var(--t3)" : "#050505",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              fontFamily: "inherit",
              cursor: blocked ? "not-allowed" : "pointer",
            }}
          >
            <SparkleIcon width={15} height={15} />
            {plan.cta}
          </button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 9, fontSize: 10.5, color: "var(--tm)" }}>
            <span>
              {blocked ? "Nothing to run" : `${plan.calls} AI ${plan.calls === 1 ? "call" : "calls"}`}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: 999, background: "var(--tm)" }} />
            <span>Gemini Flash-Lite</span>
          </div>
        </div>
      )}
    </div>
  );
}
