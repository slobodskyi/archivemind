import { CheckIcon, CloseIcon, SparkleIcon, TagIcon } from "@/components/icons/icons";
import type { CaptionStyle } from "@/types";

interface BulkAiPanelProps {
  show: boolean;
  idle: boolean;
  count: number;
  thumbs: { src: string; ml: number }[];
  bulkOps: { captions: boolean; tags: boolean; faces: boolean };
  bulkLangs: string[];
  bulkStyle: CaptionStyle;
  proc: { active: boolean; label: string; pct: number };
  onClear: () => void;
  onToggleCaptions: () => void;
  onToggleTags: () => void;
  onToggleFaces: () => void;
  onToggleLang: (l: string) => void;
  onSetStyle: (s: CaptionStyle) => void;
  onRun: () => void;
}

const LANGS = ["EN", "UK", "RU"];
const STYLES: CaptionStyle[] = ["Agency", "Archival"];

function FaceIcon({ width = 15, height = 15 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 20a5 5 0 0 0-10 0" />
      <circle cx={12} cy={9} r={3.2} />
    </svg>
  );
}

function ConsentIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4l9 16H3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

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
          <span style={{ fontSize: 13, fontWeight: 500, color: titleColor }}>{title}</span>
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

export default function BulkAiPanel({
  show,
  idle,
  count,
  thumbs,
  bulkOps,
  bulkLangs,
  bulkStyle,
  proc,
  onClear,
  onToggleCaptions,
  onToggleTags,
  onToggleFaces,
  onToggleLang,
  onSetStyle,
  onRun,
}: BulkAiPanelProps) {
  if (!show) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 78,
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
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t1)" }}>{count} photos selected</span>
            </div>
            <button
              onClick={onClear}
              aria-label="Clear selection"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t3)", cursor: "pointer" }}
            >
              <CloseIcon />
            </button>
          </div>

          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--tm)", marginBottom: 8 }}>
            AI operations
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <OpCard
              icon={<SparkleIcon width={15} height={15} />}
              title="Generate captions"
              subtitle="Multilingual · choose a style"
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
                              fontWeight: 500,
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
                            fontWeight: 500,
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

            <OpCard
              icon={<TagIcon width={15} height={15} />}
              title="Detect tags"
              subtitle="People · objects · scene · place"
              checked={bulkOps.tags}
              onToggle={onToggleTags}
            />

            <OpCard
              icon={<FaceIcon />}
              title="Detect & group faces"
              subtitle={
                <>
                  <ConsentIcon />
                  Consent required
                </>
              }
              checked={bulkOps.faces}
              onToggle={onToggleFaces}
            />
          </div>

          <button
            onClick={onRun}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              width: "100%",
              height: 40,
              marginTop: 13,
              background: "var(--ac)",
              border: 0,
              borderRadius: 2,
              color: "#050505",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.07em",
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <SparkleIcon width={15} height={15} />
            Analyze {count} photos
          </button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 9, fontSize: 10.5, color: "var(--tm)" }}>
            <span>
              {[bulkOps.captions && "Captions", bulkOps.tags && "Tags", bulkOps.faces && "Faces"].filter(Boolean).join(" · ") || "No operations selected"}
            </span>
            <span style={{ width: 3, height: 3, borderRadius: 999, background: "var(--tm)" }} />
            <span>~$0.01 · Gemini Flash-Lite</span>
          </div>
        </div>
      )}
    </div>
  );
}
