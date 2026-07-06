import { CheckIcon, CloseIcon, SparkleIcon, TagIcon, HistoryIcon } from "@/components/icons/icons";
import type { CaptionStyle } from "@/types";

interface BulkOps {
  captions: boolean;
  tags: boolean;
  timeline: boolean;
  faces: boolean;
}

interface BulkAiPanelProps {
  show: boolean;
  idle: boolean;
  count: number;
  thumbs: { src: string; ml: number }[];
  bulkOps: BulkOps;
  bulkLangs: string[];
  bulkStyle: CaptionStyle;
  proc: { active: boolean; label: string; pct: number };
  onClear: () => void;
  onToggleOp: (k: keyof BulkOps) => void;
  onToggleLang: (l: string) => void;
  onSetStyle: (s: CaptionStyle) => void;
  onRun: () => void;
}

const LANGS = ["EN", "UK", "RU"];
const STYLES: CaptionStyle[] = ["Agency", "Archival"];

function FaceIcon({ width = 16, height = 16 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 20a5 5 0 0 0-10 0" />
      <circle cx={12} cy={9} r={3.2} />
    </svg>
  );
}

function ConsentIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
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
  const cardBd = checked ? "color-mix(in srgb,var(--accent-green) 42%,transparent)" : "var(--border-subtle)";
  const cardBg = checked ? "color-mix(in srgb,var(--accent-green) 9%,var(--bg-inner))" : "var(--bg-inner)";
  const iconBg = checked ? "color-mix(in srgb,var(--accent-green) 20%,transparent)" : "var(--bg-elevated)";
  const iconColor = checked ? "var(--accent-green)" : "var(--text-tertiary)";
  const titleColor = checked ? "var(--text-primary)" : "var(--text-secondary)";
  const checkBg = checked ? "var(--accent-green)" : "transparent";
  const checkBd = checked ? "var(--accent-green)" : "var(--border-hover)";

  return (
    <div style={{ border: `1px solid ${cardBd}`, borderRadius: 11, padding: "12px 13px", background: cardBg, transition: "background .15s ease,border-color .15s ease" }}>
      <button
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", background: "transparent", border: 0, cursor: "pointer", fontFamily: "inherit", padding: 0, textAlign: "left" }}
      >
        <span
          style={{
            display: "flex",
            width: 32,
            height: 32,
            flex: "0 0 auto",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9,
            background: iconBg,
            color: iconColor,
            transition: "background .15s,color .15s",
          }}
        >
          {icon}
        </span>
        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, color: titleColor }}>{title}</span>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)", display: "flex", alignItems: "center", gap: 5 }}>{subtitle}</span>
        </span>
        <span
          style={{
            display: "flex",
            width: 19,
            height: 19,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            flex: "0 0 auto",
            background: checkBg,
            border: `1.5px solid ${checkBd}`,
            transition: "background .12s",
          }}
        >
          {checked && <CheckIcon width={11} height={11} strokeWidth={2.7} />}
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
  onToggleOp,
  onToggleLang,
  onSetStyle,
  onRun,
}: BulkAiPanelProps) {
  if (!show) return null;

  const summaryParts = [
    bulkOps.captions && "Captions",
    bulkOps.tags && "Tags",
    bulkOps.timeline && "Timeline",
    bulkOps.faces && "Faces",
  ].filter(Boolean);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 84,
        left: "50%",
        transform: "translateX(-50%)",
        width: 440,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 14,
        boxShadow: "0 16px 48px rgba(0,0,0,.6)",
        zIndex: 36,
        overflowY: "auto",
        overflowX: "hidden",
        maxHeight: "calc(100vh - 122px)",
      }}
    >
      {proc.active && (
        <div style={{ padding: "20px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <SparkleIcon width={16} height={16} />
            <span style={{ fontSize: 13, color: "var(--text-primary)" }}>{proc.label}</span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: "var(--bg-inner)", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 999, background: "var(--accent-green)", width: `${proc.pct}%`, transition: "width .25s ease" }} />
          </div>
        </div>
      )}

      {idle && (
        <div style={{ padding: "15px 16px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
              <div style={{ display: "flex" }}>
                {thumbs.map((t, i) => (
                  <div
                    key={i}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      backgroundImage: `url(${t.src})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                      border: "1.5px solid var(--bg-surface)",
                      marginLeft: t.ml,
                    }}
                  />
                ))}
              </div>
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{count} photos selected</span>
            </div>
            <button
              onClick={onClear}
              title="Deselect"
              aria-label="Clear selection"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, border: 0, background: "var(--bg-elevated)", borderRadius: 7, color: "var(--text-tertiary)", cursor: "pointer" }}
            >
              <CloseIcon width={13} height={13} strokeWidth={1.9} />
            </button>
          </div>

          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 9 }}>
            AI operations
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <OpCard
              icon={<SparkleIcon width={16} height={16} />}
              title="Generate captions"
              subtitle="Multilingual · choose a caption style"
              checked={bulkOps.captions}
              onToggle={() => onToggleOp("captions")}
            >
              {bulkOps.captions && (
                <div style={{ marginTop: 12, paddingLeft: 43, display: "flex", flexDirection: "column", gap: 9, transition: "opacity .15s ease" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)", width: 50, flex: "0 0 auto" }}>Language</span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {LANGS.map((l) => {
                        const active = bulkLangs.includes(l);
                        return (
                          <button
                            key={l}
                            onClick={() => onToggleLang(l)}
                            style={{
                              height: 25,
                              padding: "0 12px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 500,
                              fontFamily: "inherit",
                              cursor: "pointer",
                              background: active ? "var(--accent-green)" : "transparent",
                              color: active ? "#ffffff" : "var(--text-secondary)",
                              border: `1px solid ${active ? "var(--accent-green)" : "var(--border-hover)"}`,
                            }}
                          >
                            {l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)", width: 50, flex: "0 0 auto" }}>Style</span>
                    <div style={{ display: "inline-flex", gap: 3, background: "var(--bg-canvas)", borderRadius: 999, padding: 3 }}>
                      {STYLES.map((st) => (
                        <button
                          key={st}
                          onClick={() => onSetStyle(st)}
                          style={{
                            height: 24,
                            padding: "0 13px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 500,
                            fontFamily: "inherit",
                            cursor: "pointer",
                            border: 0,
                            background: bulkStyle === st ? "var(--bg-elevated)" : "transparent",
                            color: bulkStyle === st ? "#ffffff" : "var(--text-tertiary)",
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
              icon={<TagIcon width={16} height={16} />}
              title="Detect tags"
              subtitle="People · objects · scene · place"
              checked={bulkOps.tags}
              onToggle={() => onToggleOp("tags")}
            />

            <OpCard
              icon={<HistoryIcon width={16} height={16} />}
              title="Build timeline"
              subtitle="Order by capture date"
              checked={bulkOps.timeline}
              onToggle={() => onToggleOp("timeline")}
            />

            <OpCard
              icon={<FaceIcon />}
              title="Detect & group faces"
              subtitle={
                <>
                  <ConsentIcon />
                  Consent required — opt-in
                </>
              }
              checked={bulkOps.faces}
              onToggle={() => onToggleOp("faces")}
            />
          </div>

          <button
            onClick={onRun}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              width: "100%",
              height: 42,
              marginTop: 14,
              background: "var(--accent-green)",
              border: 0,
              borderRadius: 999,
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            <SparkleIcon width={16} height={16} />
            Analyze {count} photos
          </button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10, fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", flexWrap: "nowrap" }}>
            <span>{summaryParts.length ? summaryParts.join(" · ") : "Select an operation"}</span>
            <span style={{ width: 3, height: 3, borderRadius: 999, background: "var(--text-muted)" }} />
            <span>~$0.01 · Gemini Flash-Lite</span>
          </div>
        </div>
      )}
    </div>
  );
}
