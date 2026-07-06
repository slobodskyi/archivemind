import type { CaptionStyle, Language, Photo } from "@/types";
import { FACT_STATUS_COLOR, getCaptionText, statusMeta } from "@/lib/format";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  SparkleIcon,
  CopyIcon,
  AddIcon,
} from "@/components/icons/icons";

interface PhotoDrawerProps {
  photo: Photo | null;
  lang: Language;
  style: CaptionStyle;
  copyLabel: string;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSetLang: (l: Language) => void;
  onSetStyle: (s: CaptionStyle) => void;
  onRegen: () => void;
  onCopy: () => void;
  onGenSingle: () => void;
}

const LANGS: Language[] = ["EN", "UK", "RU"];
const STYLES: CaptionStyle[] = ["Social", "Agency", "Archival"];

function EditIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M14 6l4 4" />
    </svg>
  );
}

export default function PhotoDrawer({
  photo,
  lang,
  style,
  copyLabel,
  onPrev,
  onNext,
  onClose,
  onSetLang,
  onSetStyle,
  onRegen,
  onCopy,
  onGenSingle,
}: PhotoDrawerProps) {
  const sheet = photo ? "translateX(0)" : "translateX(440px)";
  const st = photo ? statusMeta(photo.status) : statusMeta("Needs check");
  const captionText = getCaptionText(photo, lang, style);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        background: "var(--bg-surface)",
        borderLeft: "1px solid var(--border-subtle)",
        boxShadow: "-16px 0 48px rgba(0,0,0,0.5)",
        zIndex: 45,
        transform: sheet,
        transition: "transform .25s cubic-bezier(.22,1,.36,1)",
        overflowY: "auto",
      }}
    >
      {photo && (
        <div style={{ padding: 16 }}>
          <div style={{ position: "relative", borderRadius: 3, overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
            <div
              style={{
                width: "100%",
                height: 240,
                backgroundImage: `url(https://picsum.photos/seed/${photo.seed}/840/480)`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            <button onClick={onPrev} aria-label="Previous photo" style={navBtn("left")}>
              <ChevronLeftIcon width={15} height={15} strokeWidth={1.8} />
            </button>
            <button onClick={onNext} aria-label="Next photo" style={navBtn("right")}>
              <ChevronRightIcon width={15} height={15} strokeWidth={1.8} />
            </button>
            <button onClick={onClose} aria-label="Close" style={navBtn("close")}>
              <CloseIcon width={14} height={14} strokeWidth={1.8} />
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>{photo.filename}</span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                height: 22,
                padding: "0 9px",
                borderRadius: 999,
                fontSize: 11,
                background: `color-mix(in srgb,${st.color} 14%, transparent)`,
                color: st.color,
                border: `1px solid color-mix(in srgb,${st.color} 35%, transparent)`,
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: 999, background: st.color }} />
              {st.label}
            </span>
          </div>

          {photo.processed && (
            <>
              <div style={{ marginTop: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={labelCaps}>AI Caption</span>
                  <div style={{ display: "flex", gap: 3, background: "var(--bg-inner)", borderRadius: 999, padding: 2 }}>
                    {LANGS.map((l) => (
                      <button
                        key={l}
                        onClick={() => onSetLang(l)}
                        style={{
                          height: 22,
                          padding: "0 11px",
                          border: 0,
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 500,
                          fontFamily: "inherit",
                          cursor: "pointer",
                          background: lang === l ? "#fff" : "transparent",
                          color: lang === l ? "#000" : "var(--text-tertiary)",
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 3, background: "var(--bg-inner)", borderRadius: 8, padding: 3, marginBottom: 10 }}>
                  {STYLES.map((ss) => (
                    <button
                      key={ss}
                      onClick={() => onSetStyle(ss)}
                      style={{
                        flex: 1,
                        height: 28,
                        border: 0,
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        background: style === ss ? "var(--bg-elevated)" : "transparent",
                        color: style === ss ? "#fff" : "var(--text-tertiary)",
                      }}
                    >
                      {ss}
                    </button>
                  ))}
                </div>
                <textarea
                  value={captionText}
                  readOnly
                  style={{
                    width: "100%",
                    minHeight: 104,
                    resize: "vertical",
                    background: "var(--bg-inner)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    padding: "11px 12px",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    outline: 0,
                  }}
                />
                <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
                  <button onClick={onRegen} style={smallBtn}>
                    <SparkleIcon width={13} height={13} />
                    Regenerate
                  </button>
                  <button onClick={onCopy} style={smallBtn}>
                    <CopyIcon width={13} height={13} />
                    {copyLabel}
                  </button>
                  <button style={smallBtn}>
                    <EditIcon />
                    Edit
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <span style={labelCaps}>Tags</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {(photo.tags ?? []).map((tg) => (
                    <span
                      key={tg}
                      style={{ height: 26, display: "flex", alignItems: "center", padding: "0 11px", borderRadius: 999, background: "var(--bg-elevated)", color: "var(--text-secondary)", fontSize: 12 }}
                    >
                      {tg}
                    </span>
                  ))}
                  <span
                    style={{
                      height: 26,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "0 11px",
                      borderRadius: 999,
                      border: "1px dashed var(--border-hover)",
                      color: "var(--text-tertiary)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    <AddIcon width={12} height={12} strokeWidth={1.8} />
                    add tag
                  </span>
                </div>
              </div>
            </>
          )}

          {!photo.processed && (
            <div style={{ marginTop: 18, background: "var(--bg-inner)", border: "1px solid var(--border-subtle)", borderRadius: 10, padding: 20, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 14 }}>
                No caption yet — this photo hasn&apos;t been processed.
              </div>
              <button
                onClick={onGenSingle}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  height: 36,
                  padding: "0 16px",
                  background: "var(--accent-green)",
                  border: 0,
                  borderRadius: 999,
                  color: "#ffffff",
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                <SparkleIcon width={15} height={15} />
                Generate caption
              </button>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <span style={labelCaps}>Metadata / EXIF</span>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", marginTop: 11, fontSize: 12 }}>
              <span style={{ color: "var(--text-tertiary)" }}>Camera</span>
              <span style={{ color: "var(--text-secondary)" }}>{photo.exif.camera}</span>
              <span style={{ color: "var(--text-tertiary)" }}>Lens</span>
              <span style={{ color: "var(--text-secondary)" }}>{photo.exif.lens}</span>
              <span style={{ color: "var(--text-tertiary)" }}>Date</span>
              <span style={{ color: "var(--text-secondary)" }}>{photo.exif.dateTaken}</span>
              <span style={{ color: "var(--text-tertiary)" }}>GPS</span>
              <span style={{ color: "var(--text-secondary)" }}>
                {photo.exif.gpsLat}, {photo.exif.gpsLon} · {photo.exif.gpsLabel}
              </span>
              <span style={{ color: "var(--text-tertiary)" }}>ISO</span>
              <span style={{ color: "var(--text-secondary)" }}>{photo.exif.iso}</span>
              <span style={{ color: "var(--text-tertiary)" }}>Aperture</span>
              <span style={{ color: "var(--text-secondary)" }}>{photo.exif.aperture}</span>
              <span style={{ color: "var(--text-tertiary)" }}>Shutter</span>
              <span style={{ color: "var(--text-secondary)" }}>{photo.exif.shutter}</span>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <span style={labelCaps}>Facts</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 11 }}>
              {photo.facts.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, color: "var(--text-secondary)" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 999, flex: "0 0 auto", background: FACT_STATUS_COLOR[f.status] }} />
                  {f.text}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 22, paddingTop: 16, borderTop: "1px solid var(--border-subtle)" }}>
            <button style={footerBtn(true)}>Confirm facts</button>
            <button style={footerBtn(false)}>Add to export</button>
          </div>
        </div>
      )}
    </div>
  );
}

const labelCaps: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--text-tertiary)",
};

const smallBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  height: 32,
  padding: "0 12px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-subtle)",
  borderRadius: 999,
  color: "var(--text-primary)",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
};

function navBtn(kind: "left" | "right" | "close"): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    display: "flex",
    width: kind === "close" ? 28 : 30,
    height: kind === "close" ? 28 : 30,
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--border-subtle)",
    background: "rgba(10,10,10,.65)",
    color: "#fff",
    borderRadius: 999,
    cursor: "pointer",
    backdropFilter: "blur(8px)",
  };
  if (kind === "left") return { ...base, left: 8, top: "50%", transform: "translateY(-50%)" };
  if (kind === "right") return { ...base, right: 8, top: "50%", transform: "translateY(-50%)" };
  return { ...base, right: 8, top: 8 };
}

function footerBtn(primary: boolean): React.CSSProperties {
  return {
    flex: 1,
    height: 38,
    background: primary ? "var(--bg-elevated)" : "transparent",
    border: `1px solid ${primary ? "var(--border-subtle)" : "var(--border-hover)"}`,
    borderRadius: 999,
    color: "var(--text-primary)",
    fontSize: 13,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}
