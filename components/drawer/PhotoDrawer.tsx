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
  /** Shifts the drawer left so it sits beside (not under) an open chat panel. */
  right?: number;
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

export default function PhotoDrawer({
  photo,
  lang,
  style,
  copyLabel,
  right = 0,
  onPrev,
  onNext,
  onClose,
  onSetLang,
  onSetStyle,
  onRegen,
  onCopy,
  onGenSingle,
}: PhotoDrawerProps) {
  const sheet = photo ? "translateX(0)" : "translateX(420px)";
  const st = photo ? statusMeta(photo.status) : statusMeta("Needs check");
  const captionText = getCaptionText(photo, lang, style);

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        right,
        bottom: 0,
        width: 410,
        background: "var(--bg-sf)",
        borderLeft: "1px solid var(--bd)",
        boxShadow: "-16px 0 48px rgba(0,0,0,.5)",
        zIndex: 45,
        transform: sheet,
        transition: "transform .25s cubic-bezier(.22,1,.36,1), right .22s cubic-bezier(.22,1,.36,1)",
        overflowY: "auto",
      }}
    >
      {photo && (
        <div style={{ padding: 14 }}>
          <div style={{ position: "relative", borderRadius: 3, overflow: "hidden", border: "1px solid var(--bd)" }}>
            <div
              style={{
                width: "100%",
                height: 220,
                backgroundImage: `url(https://picsum.photos/seed/${photo.seed}/840/480)`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            <button onClick={onPrev} aria-label="Previous photo" style={navBtn("left")}>
              <ChevronLeftIcon />
            </button>
            <button onClick={onNext} aria-label="Next photo" style={navBtn("right")}>
              <ChevronRightIcon />
            </button>
            <button onClick={onClose} aria-label="Close" style={navBtn("close")}>
              <CloseIcon width={13} height={13} strokeWidth={1.8} />
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t1)" }}>{photo.filename}</span>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                height: 21,
                padding: "0 8px",
                borderRadius: 2,
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
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
                  <span style={labelCaps}>AI Caption</span>
                  <div style={{ display: "flex", gap: 2, background: "var(--bg-in)", borderRadius: 2, padding: 2 }}>
                    {LANGS.map((l) => (
                      <button
                        key={l}
                        onClick={() => onSetLang(l)}
                        style={{
                          height: 21,
                          padding: "0 10px",
                          border: 0,
                          borderRadius: 2,
                          fontSize: 10.5,
                          fontWeight: 500,
                          fontFamily: "inherit",
                          cursor: "pointer",
                          background: lang === l ? "#fff" : "transparent",
                          color: lang === l ? "#000" : "var(--t3)",
                        }}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 2, background: "var(--bg-in)", borderRadius: 2, padding: 2, marginBottom: 9 }}>
                  {STYLES.map((ss) => (
                    <button
                      key={ss}
                      onClick={() => onSetStyle(ss)}
                      style={{
                        flex: 1,
                        height: 26,
                        border: 0,
                        borderRadius: 2,
                        fontSize: 11.5,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        background: style === ss ? "var(--bg-el)" : "transparent",
                        color: style === ss ? "#fff" : "var(--t3)",
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
                    minHeight: 96,
                    resize: "vertical",
                    background: "var(--bg-in)",
                    border: "1px solid var(--bd)",
                    borderRadius: 2,
                    padding: "10px 11px",
                    color: "var(--t1)",
                    fontSize: 12.5,
                    lineHeight: 1.5,
                    outline: 0,
                  }}
                />
                <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                  <button onClick={onRegen} style={smallBtn}>
                    <SparkleIcon />
                    Regenerate
                  </button>
                  <button onClick={onCopy} style={smallBtn}>
                    <CopyIcon />
                    {copyLabel}
                  </button>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <span style={labelCaps}>Tags</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
                  {(photo.tags ?? []).map((tg) => (
                    <span
                      key={tg}
                      style={{ height: 24, display: "flex", alignItems: "center", padding: "0 10px", borderRadius: 2, background: "var(--bg-el)", color: "var(--t2)", fontSize: 11.5 }}
                    >
                      {tg}
                    </span>
                  ))}
                  <span
                    style={{
                      height: 24,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "0 10px",
                      borderRadius: 2,
                      border: "1px dashed var(--bdh)",
                      color: "var(--t3)",
                      fontSize: 11.5,
                      cursor: "pointer",
                    }}
                  >
                    <AddIcon width={11} height={11} strokeWidth={1.8} />
                    add
                  </span>
                </div>
              </div>
            </>
          )}

          {!photo.processed && (
            <div style={{ marginTop: 16, background: "var(--bg-in)", border: "1px solid var(--bd)", borderRadius: 2, padding: 18, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--t2)", marginBottom: 12 }}>
                No caption yet — this photo hasn&apos;t been processed.
              </div>
              <button
                onClick={onGenSingle}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  height: 34,
                  padding: "0 14px",
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
                Generate caption
              </button>
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <span style={labelCaps}>Metadata / EXIF</span>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 14px", marginTop: 10, fontSize: 12 }}>
              <span style={{ color: "var(--t3)" }}>Camera</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.camera}</span>
              <span style={{ color: "var(--t3)" }}>Lens</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.lens}</span>
              <span style={{ color: "var(--t3)" }}>Date</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.dateTaken}</span>
              <span style={{ color: "var(--t3)" }}>GPS</span>
              <span style={{ color: "var(--t2)" }}>
                {photo.exif.gpsLat}, {photo.exif.gpsLon} · {photo.exif.gpsLabel}
              </span>
              <span style={{ color: "var(--t3)" }}>ISO</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.iso}</span>
              <span style={{ color: "var(--t3)" }}>Aperture</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.aperture}</span>
              <span style={{ color: "var(--t3)" }}>Shutter</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.shutter}</span>
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <span style={labelCaps}>Facts</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
              {photo.facts.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--t2)" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, flex: "0 0 auto", background: FACT_STATUS_COLOR[f.status] }} />
                  {f.text}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 7, marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--bd)" }}>
            <button style={footerBtn(true)}>Confirm facts</button>
            <button style={footerBtn(false)}>Add to export</button>
          </div>
        </div>
      )}
    </div>
  );
}

const labelCaps: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: ".04em",
  color: "var(--t3)",
};

const smallBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  height: 30,
  padding: "0 11px",
  background: "var(--bg-el)",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  color: "var(--t1)",
  fontSize: 11.5,
  fontFamily: "inherit",
  cursor: "pointer",
};

function navBtn(kind: "left" | "right" | "close"): React.CSSProperties {
  const base: React.CSSProperties = {
    position: "absolute",
    display: "flex",
    width: kind === "close" ? 26 : 28,
    height: kind === "close" ? 26 : 28,
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid var(--bd)",
    background: "rgba(10,10,10,.65)",
    color: "#fff",
    borderRadius: 2,
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
    height: 36,
    background: primary ? "var(--bg-el)" : "transparent",
    border: `1px solid ${primary ? "var(--bd)" : "var(--bdh)"}`,
    borderRadius: 2,
    color: "var(--t1)",
    fontSize: 12.5,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}
