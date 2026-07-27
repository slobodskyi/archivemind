"use client";

import { useEffect, useState } from "react";
import type { CaptionStyle, Language, Photo } from "@/types";
import { FACT_STATUS_COLOR, formatGps, getCaptionText, statusMeta } from "@/lib/format";
import { photoSrcMedium, isRealSource } from "@/lib/img";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  CloseIcon,
  SparkleIcon,
  CopyIcon,
  AddIcon,
  TrashIcon,
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
  onCopy: (text: string) => void;
  onGenSingle: () => void;
  onSaveCaption: (text: string) => void;
  onEditImage: () => void;
  /** Move to Trash (ADR 0033) — the drawer used to have no delete at all, so
   *  deletion intent formed here forced the user back out to the tile. */
  onDelete: () => void;
  /** Confirm / withdraw one extracted fact — real AI input, see the Facts
   *  block below. */
  onSetFactStatus: (factId: string, status: "confirmed" | "likely") => void;
  /** Export this one photo to PDF (ADR 0035). */
  onExport: () => void;
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
  onSaveCaption,
  onEditImage,
  onDelete,
  onSetFactStatus,
  onExport,
}: PhotoDrawerProps) {
  // The asset list presigns thumbs only; the sharper medium is fetched lazily
  // here. The thumb renders as an instant placeholder and the medium swaps in
  // when its URL lands (stale responses are ignored by id).
  const [medium, setMedium] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!photo || !isRealSource(photo.source) || photo.srcMedium) return;
    const id = photo.id;
    let alive = true;
    fetch(`/api/assets/${id}/medium`)
      .then((r) => (r.ok ? (r.json() as Promise<{ url: string | null }>) : null))
      .then((j) => {
        if (alive && j?.url) setMedium({ id, url: j.url });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [photo]);

  // Closed offset must clear the drawer's own width *plus* however far `right`
  // has already shifted it left (e.g. for an open chat panel) — otherwise the
  // "hidden" drawer lands back on-screen and covers whatever is to its right.
  const sheet = photo ? "translateX(0)" : `translateX(${410 + right + 20}px)`;
  const st = photo ? statusMeta(photo.status) : statusMeta("Needs check");
  const captionText = getCaptionText(photo, lang, style);
  const mediumSrc = photo && medium?.id === photo.id ? medium.url : undefined;

  // Caption editing (#14): local draft over the server text. Reset is done by
  // adjusting state during render (not in an effect) whenever the edited
  // scope — photo × lang × style × server text — changes.
  const [draft, setDraft] = useState<string | null>(null);
  const [draftScope, setDraftScope] = useState("");
  const captionScope = `${photo?.id ?? "none"}:${lang}:${style}:${captionText}`;
  if (draftScope !== captionScope) {
    setDraftScope(captionScope);
    setDraft(null);
  }
  const shownCaption = draft ?? captionText;
  const captionDirty = draft !== null && draft !== captionText;
  // The caption block used to be gated purely on `processed` (= the analyze
  // job's ai_processed_at). But the caption worker doesn't need analysis — it
  // reads the medium preview + EXIF — so a captions-only bulk run produced
  // captions the drawer then refused to show. Show the block whenever there is
  // something to show.
  const hasAnyCaption = Object.values(photo?.captions ?? {}).some(
    (byStyle) => Object.keys(byStyle ?? {}).length > 0,
  );
  const showCaptionBlock = Boolean(photo && (photo.processed || hasAnyCaption));

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
                backgroundImage: `url(${photoSrcMedium({ ...photo, srcMedium: photo.srcMedium ?? mediumSrc }, 840, 480)})`,
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
            {isRealSource(photo.source) && photo.src && (
              <button onClick={onEditImage} style={editPill} title="Crop, rotate, straighten or flip">
                {photo.edited && (
                  <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--ac)" }} />
                )}
                {photo.edited ? "Edited" : "Edit"}
              </button>
            )}
            {isRealSource(photo.source) && (
              <button
                onClick={onDelete}
                style={deletePill}
                aria-label="Move to Trash"
                title="Move to Trash — restorable for 30 days"
              >
                <TrashIcon width={12} height={12} />
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <span style={{ fontSize: 14, fontWeight: 400, color: "var(--t1)" }}>{photo.filename}</span>
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

          {showCaptionBlock && (
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
                          fontWeight: 400,
                          fontFamily: "inherit",
                          cursor: "pointer",
                          background: lang === l ? "#fff" : "transparent",
                          color: lang === l ? "#000" : "var(--t2b)",
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
                        color: style === ss ? "#fff" : "var(--t2b)",
                      }}
                    >
                      {ss}
                    </button>
                  ))}
                </div>
                <textarea
                  value={shownCaption}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`No ${lang} ${style.toLowerCase()} caption yet — press Generate`}
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
                  {/* "Regenerate" on an empty box asked the user to redo
                      something that was never done. It only says that once
                      there is a caption to replace. */}
                  <button onClick={onRegen} style={smallBtn}>
                    <SparkleIcon />
                    {captionText ? "Regenerate" : "Generate"}
                  </button>
                  <button onClick={() => onCopy(shownCaption)} style={smallBtn}>
                    <CopyIcon />
                    {copyLabel}
                  </button>
                  {captionDirty && (
                    <button onClick={() => onSaveCaption(shownCaption)} style={smallBtn}>
                      Save
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Tags come from analyze, not caption — a captions-only run would
              otherwise render this section empty but for the "+ add" chip. */}
          {photo.processed && (
            <>
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

          {/* Unprocessed photo: ONE button that does the whole thing. It used
              to say "Generate caption" and enqueue `analyze`, which writes tags
              and facts and never a caption — so the photo came back tagged,
              captionless, and the user was left pressing it again. It now runs
              analyze and chains the caption job behind it. */}
          {!showCaptionBlock && (
            <div style={{ marginTop: 16, background: "var(--bg-in)", border: "1px solid var(--bd)", borderRadius: 2, padding: 18, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "var(--t2)", marginBottom: 4 }}>
                This photo hasn&apos;t been processed by AI yet.
              </div>
              <div style={{ fontSize: 11, color: "var(--t3)", marginBottom: 12, lineHeight: 1.45 }}>
                Reads tags and facts, makes it searchable, then writes a {lang} {style.toLowerCase()} caption.
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
                Analyze &amp; caption
              </button>
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <span style={labelCaps}>Metadata / EXIF</span>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 14px", marginTop: 10, fontSize: 12 }}>
              {/* Labels use --t2b (4.72:1), not --t3 (2.96:1, WCAG fail) — this
                  is the readable label column, not decoration. */}
              <span style={exifLabel}>Camera</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.camera}</span>
              <span style={exifLabel}>Lens</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.lens}</span>
              <span style={exifLabel}>Date</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.dateTaken}</span>
              <span style={exifLabel}>GPS</span>
              <span style={{ color: "var(--t2)" }}>{formatGps(photo.exif)}</span>
              <span style={exifLabel}>ISO</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.iso}</span>
              <span style={exifLabel}>Aperture</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.aperture}</span>
              <span style={exifLabel}>Shutter</span>
              <span style={{ color: "var(--t2)" }}>{photo.exif.shutter}</span>
            </div>
          </div>

          {/* Facts are confirmed one at a time, and the label says why: the
              caption worker prompts with `facts where status = 'confirmed'`, so
              a confirmed fact is an AI input. The old footer "Confirm facts"
              button had no onClick at all — that query always came back empty
              and every caption was written without this context. A blanket
              confirm-all is deliberately not offered: it would launder
              unreviewed model output into the next generation's input. */}
          <div style={{ marginTop: 18 }}>
            <span style={labelCaps}>Facts</span>
            {photo.facts.some((f) => f.id) && (
              <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 5, lineHeight: 1.45 }}>
                Confirmed facts are quoted to the AI when it writes captions.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
              {photo.facts.map((f, i) => {
                const confirmed = f.status === "confirmed";
                return (
                  <div key={f.id ?? i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--t2)" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, flex: "0 0 auto", background: FACT_STATUS_COLOR[f.status] }} />
                    <span style={{ flex: 1 }}>{f.text}</span>
                    {/* Mock rows and the "Analyze to extract facts" placeholder
                        carry no id — nothing to PATCH, so no control. */}
                    {f.id && (
                      <button
                        onClick={() => onSetFactStatus(f.id!, confirmed ? "likely" : "confirmed")}
                        title={confirmed ? "Confirmed — click to withdraw" : "Confirm this fact"}
                        aria-label={confirmed ? `Withdraw confirmation: ${f.text}` : `Confirm: ${f.text}`}
                        aria-pressed={confirmed}
                        style={factBtn(confirmed)}
                      >
                        <CheckIcon width={11} height={11} />
                        {confirmed ? "Confirmed" : "Confirm"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Was "Add to export", which implied a basket that never existed.
              ADR 0035's export path is real — this now opens it for this photo. */}
          <div style={{ display: "flex", gap: 7, marginTop: 20, paddingTop: 14, borderTop: "1px solid var(--bd)" }}>
            <button onClick={onExport} style={footerBtn(true)}>
              Export PDF
            </button>
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
  // --t2b (4.72:1) clears WCAG AA; --t3 (2.96:1) does not.
  color: "var(--t2b)",
};

const exifLabel: React.CSSProperties = { color: "var(--t2b)" };

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

const editPill: React.CSSProperties = {
  position: "absolute",
  left: 8,
  bottom: 8,
  display: "flex",
  alignItems: "center",
  gap: 5,
  height: 26,
  padding: "0 12px",
  border: "1px solid var(--bd)",
  background: "rgba(10,10,10,.65)",
  color: "#fff",
  borderRadius: 2,
  fontSize: 11.5,
  fontFamily: "inherit",
  cursor: "pointer",
  backdropFilter: "blur(8px)",
};

/** Edit's danger sibling, anchored to the opposite corner so a reach for Edit
 *  can't land on Delete. */
const deletePill: React.CSSProperties = {
  ...editPill,
  left: "auto",
  right: 8,
  padding: "0 9px",
  color: "var(--red)",
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

/** Per-fact confirm control. Confirmed reads as an accent-tinted state rather
 *  than a button waiting to be pressed, so a reviewed list scans at a glance. */
function factBtn(confirmed: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flex: "0 0 auto",
    height: 22,
    padding: "0 8px",
    borderRadius: 2,
    border: `1px solid ${confirmed ? "color-mix(in srgb,var(--ac) 40%,transparent)" : "var(--bd)"}`,
    background: confirmed ? "color-mix(in srgb,var(--ac) 14%,transparent)" : "transparent",
    color: confirmed ? "var(--ac)" : "var(--t2b)",
    fontSize: 10.5,
    fontFamily: "inherit",
    cursor: "pointer",
    transition: "background .12s, color .12s, border-color .12s",
  };
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
