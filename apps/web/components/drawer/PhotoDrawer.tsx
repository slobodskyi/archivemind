"use client";

import { useEffect, useState } from "react";
import type { AssetLabel, LabelNames, PatchAssetExifRequest } from "@archivemind/shared";
import type { CaptionStyle, Language, Photo } from "@/types";
import { FACT_STATUS_COLOR, formatGps, getCaptionText, statusMeta } from "@/lib/format";
import { photoSrcMedium, isRealSource } from "@/lib/img";
import LabelSwatchRow from "@/components/labels/LabelSwatchRow";
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
  /** Persist a manual Metadata/EXIF correction (migration 20260805000001). */
  onSaveExif: (patch: PatchAssetExifRequest) => void;
  /** Drop every manual correction, restoring what ingest extracted. */
  onRevertExif: () => void;
  /** Colour label for THIS photo (migration 20260808000001) — the single-photo
   *  entry point, next to the canvas's selection-wide ones. */
  labelNames: LabelNames;
  onPickLabel: (label: AssetLabel | null) => void;
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
  onSaveExif,
  onRevertExif,
  labelNames,
  onPickLabel,
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

  // Manual Metadata/EXIF editing (migration 20260805000001). A local draft over
  // the server values, saved explicitly — the same reset-during-render pattern
  // as the caption draft above, keyed on the photo AND on the values themselves
  // so a successful save (which refreshes the row) drops the draft instead of
  // leaving it shadowing the value that just came back.
  const ex = photo?.exif;
  const [exifEditing, setExifEditing] = useState(false);
  const [exifDraft, setExifDraft] = useState<Record<string, string>>({});
  const [exifScope, setExifScope] = useState("");
  const exifKey = photo
    ? `${photo.id}:${ex?.camera}:${ex?.lens}:${ex?.takenAtIso}:${ex?.iso}:${ex?.aperture}:${ex?.shutter}:${ex?.gpsLat}:${ex?.gpsLon}:${ex?.gpsLabel}`
    : "none";
  if (exifScope !== exifKey) {
    setExifScope(exifKey);
    setExifDraft({});
    setExifEditing(false);
  }
  const exifVal = (key: string, fallback: string | number) =>
    exifDraft[key] ?? String(fallback);
  const setExifField = (key: string, v: string) =>
    setExifDraft((d) => ({ ...d, [key]: v }));
  const exifEdited = new Set(ex?.editedFields ?? []);
  // The em dash is the drawer's "no value" glyph, not a value — an untouched
  // field must not be sent as the literal "—" when some *other* field is saved.
  const asEdit = (key: string, current: string | number) => {
    const raw = exifDraft[key];
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    if (trimmed === String(current).trim()) return undefined;
    return trimmed === "" || trimmed === "—" ? null : trimmed;
  };
  const exifDirty = Object.keys(exifDraft).length > 0;

  /** Collect the changed fields into the route's shape. Untouched fields are
   *  omitted entirely — the contract treats omitted as "leave alone" and null as
   *  "clear", so sending everything would wipe fields the user never opened. */
  const buildExifPatch = () => {
    if (!ex) return null;
    const patch: Record<string, unknown> = {};
    const camera = asEdit("camera", ex.camera);
    if (camera !== undefined) patch.camera = camera;
    const lens = asEdit("lens", ex.lens);
    if (lens !== undefined) patch.lens = lens;
    const aperture = asEdit("aperture", ex.aperture);
    if (aperture !== undefined) patch.aperture = aperture;
    const shutter = asEdit("shutter", ex.shutter);
    if (shutter !== undefined) patch.shutter = shutter;
    const gpsLabel = asEdit("gpsLabel", ex.gpsLabel);
    if (gpsLabel !== undefined) patch.gpsLabel = gpsLabel;

    const isoRaw = exifDraft.iso;
    if (isoRaw !== undefined && isoRaw.trim() !== String(ex.iso)) {
      const n = Number(isoRaw.trim());
      // A non-numeric ISO is dropped rather than sent — the contract would
      // reject the whole patch and take the other fields down with it.
      if (isoRaw.trim() === "" || isoRaw.trim() === "—") patch.iso = null;
      else if (Number.isInteger(n) && n >= 0) patch.iso = n;
    }

    const dateRaw = exifDraft.dateTaken;
    if (dateRaw !== undefined) {
      const trimmed = dateRaw.trim();
      if (trimmed === "") patch.takenAt = null;
      else {
        // <input type="datetime-local"> yields wall-clock with no zone; the
        // Date constructor reads that as local time, which is what the user
        // meant, and toISOString sends the absolute instant.
        const d = new Date(trimmed);
        if (!Number.isNaN(d.getTime()) && d.toISOString() !== ex.takenAtIso) {
          patch.takenAt = d.toISOString();
        }
      }
    }

    // Latitude and longitude travel together or not at all (the contract
    // refuses half a pair), so both are sent whenever either was touched.
    const latRaw = exifDraft.gpsLat;
    const lonRaw = exifDraft.gpsLon;
    if (latRaw !== undefined || lonRaw !== undefined) {
      const lat = (latRaw ?? String(ex.gpsLat ?? "")).trim();
      const lon = (lonRaw ?? String(ex.gpsLon ?? "")).trim();
      if (lat === "" && lon === "") {
        patch.gpsLat = null;
        patch.gpsLon = null;
      } else {
        const la = Number(lat);
        const lo = Number(lon);
        if (Number.isFinite(la) && Number.isFinite(lo) && (la !== ex.gpsLat || lo !== ex.gpsLon)) {
          patch.gpsLat = la;
          patch.gpsLon = lo;
        }
      }
    }
    return Object.keys(patch).length > 0 ? patch : null;
  };

  /** Local-time value for <input type="datetime-local">, which refuses an ISO
   *  string with a zone. Empty when the asset has no real taken_at. */
  const dateTimeLocal = (iso: string | null) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        right,
        bottom: 0,
        // Fixed 410 overflowed any viewport narrower than itself; the slide-out
        // transform below stays 410-based, which is still ≥ the rendered width.
        width: "min(410px, 100vw)",
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

          {/* Colour label. Directly under the filename because that is what it
              qualifies — this photo, by name — and above everything the AI
              produced, which is the other half of the drawer. */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
            <span style={labelCaps}>
              {photo.label ? labelNames[photo.label] : "Label"}
            </span>
            <LabelSwatchRow
              names={labelNames}
              current={photo.label ?? null}
              onPick={onPickLabel}
              size={15}
            />
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={labelCaps}>Metadata / EXIF</span>
              {/* Editing is only offered on real assets: a mock row has no
                  asset_exif row behind it, so the route would have nothing to
                  correct and every save would 404. */}
              {isRealSource(photo.source) && (
                <button
                  onClick={() => setExifEditing((v) => !v)}
                  title={exifEditing ? "Stop editing" : "Correct the metadata by hand"}
                  aria-label={exifEditing ? "Stop editing metadata" : "Correct the metadata by hand"}
                  aria-pressed={exifEditing}
                  style={exifEditBtn(exifEditing)}
                >
                  {exifEditing ? <CloseIcon width={10} height={10} strokeWidth={2.2} /> : <PenGlyph />}
                  {exifEditing ? "Cancel" : "Edit"}
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "7px 14px", marginTop: 10, fontSize: 12, alignItems: "center" }}>
              {/* Labels use --t2b (4.72:1), not --t3 (2.96:1, WCAG fail) — this
                  is the readable label column, not decoration. */}
              <ExifLabel text="Camera" edited={exifEdited.has("camera_model") || exifEdited.has("camera_make")} />
              <ExifField editing={exifEditing} value={exifVal("camera", photo.exif.camera)} onChange={(v) => setExifField("camera", v)} />
              <ExifLabel text="Lens" edited={exifEdited.has("lens")} />
              <ExifField editing={exifEditing} value={exifVal("lens", photo.exif.lens)} onChange={(v) => setExifField("lens", v)} />
              <ExifLabel text="Date" edited={exifEdited.has("taken_at")} />
              {/* A date is an instant, not prose: a text box would accept
                  "yesterday" and silently drop the edit. The native picker also
                  keeps the value parseable back to a real timestamp, which
                  matters because taken_at drives the Timeline and the search
                  date filters. */}
              {exifEditing ? (
                <input
                  type="datetime-local"
                  value={exifDraft.dateTaken ?? dateTimeLocal(photo.exif.takenAtIso)}
                  onChange={(e) => setExifField("dateTaken", e.target.value)}
                  style={exifInput}
                />
              ) : (
                <span style={{ color: "var(--t2)" }}>{photo.exif.dateTaken}</span>
              )}
              <ExifLabel text="GPS" edited={exifEdited.has("gps_lat") || exifEdited.has("gps_lon")} />
              {exifEditing ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    value={exifDraft.gpsLat ?? String(photo.exif.gpsLat ?? "")}
                    onChange={(e) => setExifField("gpsLat", e.target.value)}
                    placeholder="lat"
                    inputMode="decimal"
                    aria-label="Latitude"
                    style={{ ...exifInput, flex: 1, minWidth: 0 }}
                  />
                  <input
                    value={exifDraft.gpsLon ?? String(photo.exif.gpsLon ?? "")}
                    onChange={(e) => setExifField("gpsLon", e.target.value)}
                    placeholder="lon"
                    inputMode="decimal"
                    aria-label="Longitude"
                    style={{ ...exifInput, flex: 1, minWidth: 0 }}
                  />
                </div>
              ) : (
                <span style={{ color: "var(--t2)" }}>{formatGps(photo.exif)}</span>
              )}
              {exifEditing && (
                <>
                  <ExifLabel text="Place" edited={exifEdited.has("gps_label")} />
                  <ExifField editing value={exifVal("gpsLabel", photo.exif.gpsLabel)} onChange={(v) => setExifField("gpsLabel", v)} />
                </>
              )}
              <ExifLabel text="ISO" edited={exifEdited.has("iso")} />
              <ExifField editing={exifEditing} value={exifVal("iso", photo.exif.iso)} onChange={(v) => setExifField("iso", v)} />
              <ExifLabel text="Aperture" edited={exifEdited.has("aperture")} />
              <ExifField editing={exifEditing} value={exifVal("aperture", photo.exif.aperture)} onChange={(v) => setExifField("aperture", v)} />
              <ExifLabel text="Shutter" edited={exifEdited.has("shutter")} />
              <ExifField editing={exifEditing} value={exifVal("shutter", photo.exif.shutter)} onChange={(v) => setExifField("shutter", v)} />
            </div>

            {exifEditing && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11 }}>
                <button
                  onClick={() => {
                    const patch = buildExifPatch();
                    if (patch) onSaveExif(patch as PatchAssetExifRequest);
                    setExifEditing(false);
                  }}
                  disabled={!exifDirty}
                  style={footerBtn(exifDirty)}
                >
                  Save metadata
                </button>
                {exifEdited.size > 0 && (
                  <button
                    onClick={() => {
                      onRevertExif();
                      setExifEditing(false);
                    }}
                    title="Restore the values read from the file itself"
                    style={footerBtn(false)}
                  >
                    Revert
                  </button>
                )}
              </div>
            )}
            {!exifEditing && exifEdited.size > 0 && (
              <span style={{ display: "block", marginTop: 8, fontSize: 10.5, color: "var(--t2b)" }}>
                Edited by hand — the dot marks each corrected field.
              </span>
            )}
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
              Export
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* Pen glyph for the Metadata/EXIF edit toggle. */
const PenGlyph = () => (
  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);

/** Shared look for every editable Metadata/EXIF cell — plain text, the date
 *  picker and the two GPS boxes, so they line up as one column. */
const exifInput: React.CSSProperties = {
  width: "100%",
  height: 24,
  background: "var(--bg-in)",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  padding: "0 7px",
  color: "var(--t1)",
  fontSize: 12,
  fontFamily: "inherit",
  outline: 0,
};

/** One Metadata/EXIF value cell: a read-only span, or an input while editing. */
function ExifField({ editing, value, onChange }: { editing: boolean; value: string; onChange: (v: string) => void }) {
  if (!editing) return <span style={{ color: "var(--t2)" }}>{value}</span>;
  return <input value={value} onChange={(e) => onChange(e.target.value)} style={exifInput} />;
}

/** A Metadata/EXIF row label, dotted when a human has corrected that field.
 *  The dot matters because a corrected value is indistinguishable from an
 *  extracted one once it is stored in the same column — and the difference is
 *  exactly what a second person reading the archive needs to know. */
function ExifLabel({ text, edited }: { text: string; edited: boolean }) {
  return (
    <span style={{ ...exifLabel, display: "flex", alignItems: "center", gap: 5 }}>
      {text}
      {edited && (
        <span
          title="Corrected by hand"
          aria-label="Corrected by hand"
          style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--ac)", flex: "0 0 auto" }}
        />
      )}
    </span>
  );
}

function exifEditBtn(active: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: 22,
    padding: "0 8px",
    borderRadius: 2,
    border: `1px solid ${active ? "color-mix(in srgb,var(--ac) 40%,transparent)" : "var(--bd)"}`,
    background: active ? "color-mix(in srgb,var(--ac) 14%,transparent)" : "transparent",
    color: active ? "var(--ac)" : "var(--t2b)",
    fontSize: 10.5,
    fontFamily: "inherit",
    cursor: "pointer",
  };
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
