import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { EXPORT_MAX_ASSETS, type ArtboardSettings, type WorkspaceInfo } from "@archivemind/shared";
import type { CaptionStyle, Language, Photo } from "@/types";
import { useDialog } from "@/hooks/useDialog";
import { photoSrc } from "@/lib/img";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";

interface ExportDialogProps {
  /** Asset ids in page order (openExportFor puts them in reading order). */
  assetIds: string[];
  /** The workspace's loaded photos — the dialog looks up the ones it exports. */
  photos: Photo[];
  /** Suggested document name — the current project's label. */
  defaultTitle?: string;
  onClose: () => void;
}

type Phase = "config" | "working" | "ready" | "error";

const LANGS: { key: ArtboardSettings["captionLang"]; label: string }[] = [
  { key: "en", label: "EN" },
  { key: "uk", label: "UK" },
  { key: "ru", label: "RU" },
];
const STYLES: { key: ArtboardSettings["captionStyle"]; label: string }[] = [
  { key: "social", label: "Social" },
  { key: "agency", label: "Agency" },
  { key: "archival", label: "Archival" },
];

/** ArtboardSettings speaks the DB's lowercase enums; Photo.captions is keyed by
 *  the UI's cased unions. One place to bridge them. */
const LANG_UI: Record<ArtboardSettings["captionLang"], Language> = { en: "EN", uk: "UK", ru: "RU" };
const STYLE_UI: Record<ArtboardSettings["captionStyle"], CaptionStyle> = {
  social: "Social",
  agency: "Agency",
  archival: "Archival",
};

const POLL_MS = 1500;
/** No status change for this long → offer Retry instead of spinning forever.
 *  Nothing in the system moves a `queued` job to `failed` (reapStaleJobs only
 *  rescues `running`), so a worker that never claims it would poll for ever. */
const STALL_MS = 5 * 60 * 1000;

const ENQUEUE_ERROR_COPY: Record<string, string> = {
  too_many_assets: `An export covers up to ${EXPORT_MAX_ASSETS} photos at a time. Deselect some and try again.`,
  no_matching_assets: "Those photos aren't available any more — they may be in Trash.",
  group_not_found: "That artboard no longer exists.",
  unauthorized: "Your session expired. Reload the page and sign in again.",
  no_workspace: "No workspace found for your account.",
  export_backlog: "You already have exports rendering. Wait for those to finish and try again.",
};

/** Worker-side failures (ai_jobs.error). Codes may carry a `:detail` suffix, e.g.
 *  `export_too_large:2.4GB`, so match on the prefix. */
const JOB_ERROR_COPY: { code: string; copy: string }[] = [
  {
    code: "export_too_large",
    copy: "That selection is too large to bundle. Pick fewer photos, or switch to Web-size.",
  },
  { code: "zip_too_many_entries", copy: "That is too many files for one archive. Split it into a few exports." },
  { code: "zip_too_large", copy: "That bundle would be too big. Pick fewer photos, or switch to Web-size." },
  { code: "export_empty", copy: "Nothing in that selection could be exported — the photos may be in Trash." },
  { code: "export_font_missing", copy: "The PDF renderer is misconfigured on our side. We're on it." },
];

const jobErrorCopy = (raw: string | null): string | null =>
  JOB_ERROR_COPY.find((e) => raw?.startsWith(e.code))?.copy ?? null;

const CARD: React.CSSProperties = {
  background: "var(--bg-el)",
  border: "1px solid var(--bd)",
  borderRadius: 4,
  padding: 20,
  width: 420,
  maxWidth: "92vw",
  fontFamily: "inherit",
};
const INPUT: React.CSSProperties = {
  width: "100%",
  height: 28,
  padding: "0 8px",
  background: "var(--bg-sf)",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  color: "var(--t1)",
  fontSize: 11.5,
  fontFamily: "inherit",
};
const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--t3)",
  marginBottom: 6,
};

/** Artboard / selection → PDF export dialog (ADR 0035). Configures the document,
 *  POSTs /api/exports, follows the job's real progress, then offers the PDF.
 *
 *  It reports what the run will actually contain before the user commits: which
 *  photos are in it and in what order, which of them have no caption in the
 *  chosen language (`resolveCaptionText` silently falls back to English, or to
 *  nothing), and which have no preview yet (those print as a blank frame). Any
 *  photo can be dropped from the run without touching the canvas selection.
 *
 *  Mounted only while open, so its state resets naturally each time (the parent
 *  gates it with `&&`). */
export default function ExportDialog({ assetIds, photos, defaultTitle, onClose }: ExportDialogProps) {
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [cover, setCover] = useState(false);
  /** Workspace credit block — fetched lazily, edited here because the app has no
   *  settings page and this is the only place a byline matters. */
  const [credit, setCredit] = useState<WorkspaceInfo | null>(null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [format, setFormat] = useState<ArtboardSettings["format"]>("pdf");
  const [zipContents, setZipContents] = useState<ArtboardSettings["zipContents"]>("originals");
  const [layout, setLayout] = useState<ArtboardSettings["pageLayout"]>("one_per_page");
  const [pageSize, setPageSize] = useState<ArtboardSettings["pageSize"]>("A4");
  const [orientation, setOrientation] = useState<ArtboardSettings["orientation"]>("portrait");
  const [captionLang, setCaptionLang] = useState<ArtboardSettings["captionLang"]>("en");
  const [captionStyle, setCaptionStyle] = useState<ArtboardSettings["captionStyle"]>("agency");
  const [inc, setInc] = useState({ caption: true, title: true, exif: false });
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("config");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const titleId = useId();

  const stopPoll = useCallback(() => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  }, []);

  // Stop polling if the dialog unmounts mid-job (cleanup only — no state writes).
  useEffect(() => stopPoll, [stopPoll]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const r = await fetch("/api/workspace");
        if (!r.ok) return;
        const info = (await r.json()) as WorkspaceInfo;
        if (live) setCredit(info);
      } catch {
        // The credit block is optional — its absence must not block an export.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const saveCredit = useCallback(async (patch: Partial<WorkspaceInfo>) => {
    setCredit((prev) => (prev ? { ...prev, ...patch } : prev));
    try {
      await fetch("/api/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      // Optimistic: the next open re-reads the server's copy.
    }
  }, []);

  // While rendering, this dialog is the only place the finished link appears, so
  // it must not be dismissed out from under the job. The stall deadline below
  // guarantees the user is never stuck here indefinitely.
  const requestClose = useCallback(() => {
    if (phase !== "working") onClose();
  }, [phase, onClose]);
  const dialogRef = useDialog<HTMLDivElement>(true, requestClose);

  /** The run, in page order, with dropped photos removed. */
  const items = useMemo(() => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    return assetIds.filter((id) => !dropped.has(id)).map((id) => ({ id, photo: byId.get(id) }));
  }, [assetIds, photos, dropped]);

  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const count = ids.length;
  const isCsv = format === "captions_csv";
  const isZip = format === "zip";
  /** Both non-PDF formats skip the page-layout controls entirely. */
  const isDoc = format === "pdf";

  const captionState = useCallback(
    (photo: Photo | undefined): "exact" | "fallback" | "none" => {
      const all = photo?.captions;
      if (!all) return "none";
      if (all[LANG_UI[captionLang]]?.[STYLE_UI[captionStyle]]) return "exact";
      const any = Object.values(all).some((byStyle) => byStyle && Object.keys(byStyle).length > 0);
      return any ? "fallback" : "none";
    },
    [captionLang, captionStyle],
  );

  const warnings = useMemo(() => {
    // A CSV embeds no images and omits nothing: a missing preview or caption is
    // simply an empty cell, which is information rather than a broken page.
    if (isCsv) return [];
    if (isZip) {
      // A zip ships bytes, so the only thing that can be missing is bytes.
      const noBytes = items.filter((i) => i.photo && !i.photo.srcMedium && !i.photo.src).length;
      return noBytes > 0 ? [`${noBytes} of ${count} have nothing stored yet and will be listed in README.txt.`] : [];
    }
    if (!inc.caption && count > 0) {
      const noPreview = items.filter((i) => i.photo && !i.photo.srcMedium && !i.photo.src).length;
      return noPreview > 0 ? [`${noPreview} of ${count} have no preview yet — those pages print blank.`] : [];
    }
    let fallback = 0;
    let none = 0;
    let noPreview = 0;
    for (const { photo } of items) {
      const state = captionState(photo);
      if (state === "fallback") fallback += 1;
      if (state === "none") none += 1;
      if (photo && !photo.srcMedium && !photo.src) noPreview += 1;
    }
    const out: string[] = [];
    const langLabel = `${LANG_UI[captionLang]} · ${STYLE_UI[captionStyle]}`;
    if (fallback > 0) out.push(`${fallback} of ${count} have no ${langLabel} caption — those fall back to another one.`);
    if (none > 0) out.push(`${none} have no caption at all and will print without one.`);
    if (noPreview > 0) out.push(`${noPreview} have no preview yet — those pages print blank.`);
    return out;
  }, [items, count, isCsv, isZip, inc.caption, captionLang, captionStyle, captionState]);

  const options: ArtboardSettings = useMemo(
    () => ({ format, zipContents, cover, pageLayout: layout, pageSize, orientation, captionLang, captionStyle, include: inc }),
    [format, zipContents, cover, layout, pageSize, orientation, captionLang, captionStyle, inc],
  );

  // Describe what the run will actually contain — the old copy promised a
  // caption under every photo even with the Caption toggle off.
  const under = useMemo(() => {
    const on = [inc.title && "title", inc.caption && "caption", inc.exif && "EXIF"].filter(Boolean) as string[];
    return on.length === 0 ? "photos only" : `${on.join(" + ")} under each`;
  }, [inc]);

  const start = useCallback(async () => {
    setPhase("working");
    setErr("");
    setProgress(0);
    setProgressLabel(null);
    try {
      const res = await fetch("/api/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds: ids, title: title.trim() || undefined, options }),
      });
      const data = (await res.json().catch(() => null)) as
        | { jobId?: string; accepted?: number | null; error?: string }
        | null;
      if (!res.ok || !data?.jobId) {
        setErr(ENQUEUE_ERROR_COPY[data?.error ?? ""] ?? "Couldn't start the export. Please try again.");
        setPhase("error");
        return;
      }
      setJobId(data.jobId);
      // The route drops ids that are no longer active, so the count it accepted
      // can be lower than the one this dialog just displayed.
      if (typeof data.accepted === "number" && data.accepted < ids.length) {
        setProgressLabel(`Rendering ${data.accepted} of ${ids.length} — the rest are no longer available`);
      }

      const startedAt = Date.now();
      let lastChange = Date.now();
      let lastSeen = "";
      stopPoll();
      poll.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/exports?jobId=${data.jobId}`);
          if (!r.ok) return;
          const j = (await r.json()) as {
            status: string;
            url: string | null;
            progress?: number;
            progressLabel?: string | null;
            doneItems?: number | null;
            totalItems?: number | null;
            error?: string | null;
          };
          const seen = `${j.status}:${j.progress ?? 0}:${j.doneItems ?? ""}`;
          if (seen !== lastSeen) {
            lastSeen = seen;
            lastChange = Date.now();
          }
          if (typeof j.progress === "number") setProgress(j.progress);
          if (j.progressLabel) setProgressLabel(j.progressLabel);

          if (j.status === "done" && j.url) {
            stopPoll();
            setUrl(j.url);
            setPhase("ready");
          } else if (j.status === "failed" || j.status === "canceled") {
            stopPoll();
            setErr(
              jobErrorCopy(j.error ?? null) ??
                "The render failed. Try again — if it keeps failing, send us this job id.",
            );
            setPhase("error");
          } else if (Date.now() - lastChange > STALL_MS) {
            // Queued with nobody claiming it, or a render wedged mid-flight.
            stopPoll();
            setErr(
              j.status === "queued"
                ? "This export is still waiting for the render worker. It may be offline — try again in a moment."
                : "The render stopped responding. Try again.",
            );
            setPhase("error");
          } else if (Date.now() - startedAt > STALL_MS * 4) {
            stopPoll();
            setErr("This is taking much longer than expected. Try a smaller selection.");
            setPhase("error");
          }
        } catch {
          // transient — keep polling
        }
      }, POLL_MS);
    } catch {
      setErr("Couldn't start the export. Please try again.");
      setPhase("error");
    }
  }, [ids, title, options, stopPoll]);

  const seg = (active: boolean, disabled = false): React.CSSProperties => ({
    flex: 1,
    height: 30,
    border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`,
    background: active ? "color-mix(in srgb, var(--ac) 14%, transparent)" : "transparent",
    color: active ? "var(--ac)" : "var(--t2)",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontFamily: "inherit",
  });

  const dot = (state: "exact" | "fallback" | "none"): React.CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 999,
    flex: "0 0 auto",
    background: state === "exact" ? "var(--ac)" : state === "fallback" ? "#e0a33c" : "var(--bd)",
  });

  return (
    <div
      onPointerDown={requestClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.modal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: MODAL_BACKDROP,
        backdropFilter: MODAL_BLUR,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
        style={CARD}
      >
        <div id={titleId} style={{ fontSize: 13, fontWeight: 800, color: "var(--t1)", marginBottom: 2 }}>
          {isCsv ? "Export captions as CSV" : isZip ? "Download as ZIP" : "Export to PDF"}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--t3)", marginBottom: 16 }}>
          {count} {count === 1 ? "photo" : "photos"} ·{" "}
          {isCsv
            ? "one row each · captions in EN, UK and RU"
            : isZip
              ? `${zipContents === "originals" ? "original files" : "web-size images"} · captions.csv included`
              : `${under}${layout === "one_per_page" ? ` · ${count} ${count === 1 ? "page" : "pages"}` : " · 2 per row"}`}
        </div>

        {phase === "ready" && url ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 12, color: "var(--t2)" }}>
              Your {isCsv ? "CSV" : isZip ? "ZIP" : "PDF"} is ready.
            </div>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              data-autofocus=""
              style={{
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--ac)",
                color: "#050505",
                borderRadius: 2,
                fontSize: 12,
                fontWeight: 800,
                textDecoration: "none",
              }}
            >
              Download {isCsv ? "CSV" : isZip ? "ZIP" : "PDF"}
            </a>
            <button onClick={onClose} style={{ ...seg(false), height: 32 }}>
              Close
            </button>
          </div>
        ) : phase === "working" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0 4px" }} aria-live="polite">
            <div style={{ fontSize: 12, color: "var(--t2)" }}>
              {progressLabel ?? (isCsv ? "Collecting captions…" : isZip ? "Packing your files…" : "Rendering your PDF…")}
            </div>
            <div
              style={{ height: 3, background: "var(--bd)", borderRadius: 2, overflow: "hidden", position: "relative" }}
              role="progressbar"
              aria-valuenow={progress || undefined}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              {progress > 0 ? (
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, progress)}%`,
                    background: "var(--ac)",
                    transition: "width .3s linear",
                  }}
                />
              ) : (
                // Nothing to report yet (queued, or not claimed) — say so with
                // motion rather than a fake percentage.
                <div className="am-progress-indeterminate" style={{ position: "absolute", top: 0, height: "100%", width: "35%", background: "var(--ac)" }} />
              )}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
              Keep this open — the download appears here when it&rsquo;s done.
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {count > 0 && (
              <div>
                <div style={LABEL}>{isDoc ? "Pages, in order" : "Rows, in order"}</div>
                <div
                  style={{
                    maxHeight: 148,
                    overflowY: "auto",
                    border: "1px solid var(--bd)",
                    borderRadius: 2,
                  }}
                >
                  {items.map(({ id, photo }, i) => {
                    const state = captionState(photo);
                    return (
                      <div
                        key={id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 6px",
                          borderBottom: i === items.length - 1 ? "none" : "1px solid var(--bd)",
                        }}
                      >
                        <span style={{ fontSize: 10, color: "var(--t3)", width: 20, flex: "0 0 auto", textAlign: "right" }}>
                          {i + 1}
                        </span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={photo ? photoSrc(photo, 48, 48) : undefined}
                          alt=""
                          style={{ width: 26, height: 26, objectFit: "cover", borderRadius: 1, flex: "0 0 auto", background: "var(--bg-sf)" }}
                        />
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--t2)",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {photo?.filename ?? id}
                        </span>
                        {inc.caption && (
                          <span
                            style={dot(state)}
                            title={
                              state === "exact"
                                ? `Has a ${LANG_UI[captionLang]} · ${STYLE_UI[captionStyle]} caption`
                                : state === "fallback"
                                  ? `No ${LANG_UI[captionLang]} · ${STYLE_UI[captionStyle]} caption — falls back to another`
                                  : "No caption yet"
                            }
                          />
                        )}
                        <button
                          onClick={() => setDropped((prev) => new Set(prev).add(id))}
                          title="Leave this photo out of the PDF"
                          aria-label={`Remove ${photo?.filename ?? "photo"} from the export`}
                          style={{
                            width: 18,
                            height: 18,
                            flex: "0 0 auto",
                            border: 0,
                            background: "transparent",
                            color: "var(--t3)",
                            cursor: "pointer",
                            fontSize: 13,
                            lineHeight: 1,
                            fontFamily: "inherit",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
                {warnings.length > 0 && (
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                    {warnings.map((w) => (
                      <div key={w} style={{ fontSize: 10.5, color: "var(--t3)" }}>
                        {w}
                      </div>
                    ))}
                  </div>
                )}
                {dropped.size > 0 && (
                  <button
                    onClick={() => setDropped(new Set())}
                    style={{
                      marginTop: 6,
                      height: 22,
                      padding: "0 8px",
                      border: "1px solid var(--bd)",
                      background: "transparent",
                      color: "var(--t2)",
                      borderRadius: 2,
                      fontSize: 10.5,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    Put back {dropped.size} removed
                  </button>
                )}
              </div>
            )}

            <div>
              <div style={LABEL}>Document name</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="Untitled"
                aria-label="Document name"
                style={INPUT}
              />
              <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 4 }}>
                Used for the file name{isDoc ? ", the PDF title and the cover page" : ""}.
              </div>
            </div>

            <div>
              <div style={LABEL}>Format</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={seg(format === "pdf")} onClick={() => setFormat("pdf")}>
                  PDF document
                </button>
                <button style={seg(isCsv)} onClick={() => setFormat("captions_csv")}>
                  Captions CSV
                </button>
                <button style={seg(isZip)} onClick={() => setFormat("zip")}>
                  ZIP
                </button>
              </div>
              {isCsv && (
                <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 6 }}>
                  One row per photo: filename, full EXIF, place, tags, the AI description, facts split
                  by review status, and the captions in all three languages of the chosen style.
                </div>
              )}
              {isZip && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={seg(zipContents === "originals")} onClick={() => setZipContents("originals")}>
                      Originals
                    </button>
                    <button style={seg(zipContents === "web")} onClick={() => setZipContents("web")}>
                      Web-size
                    </button>
                  </div>
                  <div style={{ fontSize: 10.5, color: "var(--t3)", marginTop: 6 }}>
                    {zipContents === "originals"
                      ? "The files as uploaded. Photos imported from Google Drive have no copy here — those come as web-size previews, listed in README.txt."
                      : "1024px previews of everything — small enough to email."}
                  </div>
                </div>
              )}
            </div>

            {isDoc && (
              <>
                <div>
                  <div style={LABEL}>Layout</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={seg(layout === "one_per_page")} onClick={() => setLayout("one_per_page")}>
                      One per page
                    </button>
                    <button style={seg(layout === "grid")} onClick={() => setLayout("grid")}>
                      Grid
                    </button>
                  </div>
                </div>

                <div>
                  <div style={LABEL}>Page</div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                    <button style={seg(pageSize === "A4")} onClick={() => setPageSize("A4")}>
                      A4
                    </button>
                    <button style={seg(pageSize === "Letter")} onClick={() => setPageSize("Letter")}>
                      Letter
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button style={seg(orientation === "portrait")} onClick={() => setOrientation("portrait")}>
                      Portrait
                    </button>
                    <button style={seg(orientation === "landscape")} onClick={() => setOrientation("landscape")}>
                      Landscape
                    </button>
                  </div>
                </div>
              </>
            )}

            <div>
              <div style={LABEL}>{isDoc ? "Caption language / style" : "Caption style"}</div>
              {/* A CSV carries every language, so the lang picker would be a
                  control that changes nothing — say that instead of showing it. */}
              {!isDoc ? (
                <div style={{ fontSize: 10.5, color: "var(--t3)", marginBottom: 6 }}>
                  All three languages are included as their own columns.
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  {LANGS.map((l) => (
                    <button
                      key={l.key}
                      style={seg(captionLang === l.key, !inc.caption)}
                      disabled={!inc.caption}
                      onClick={() => setCaptionLang(l.key)}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 6 }}>
                {STYLES.map((s) => (
                  <button
                    key={s.key}
                    style={seg(captionStyle === s.key, isDoc && !inc.caption)}
                    disabled={isDoc && !inc.caption}
                    onClick={() => setCaptionStyle(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {isDoc && (
              <div>
                <div style={LABEL}>Under each photo</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(
                    [
                      ["caption", "Caption"],
                      ["title", "Title"],
                      ["exif", "EXIF"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      style={{ ...seg(inc[key]), flex: "0 0 auto", padding: "0 12px" }}
                      aria-pressed={inc[key]}
                      onClick={() => setInc((p) => ({ ...p, [key]: !p[key] }))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isDoc && (
              <div>
                <div style={LABEL}>Cover page</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={seg(!cover)} onClick={() => setCover(false)} aria-pressed={!cover}>
                    No cover
                  </button>
                  <button style={seg(cover)} onClick={() => setCover(true)} aria-pressed={cover}>
                    Add cover
                  </button>
                </div>
              </div>
            )}

            <div>
              <button
                onClick={() => setCreditOpen((v) => !v)}
                aria-expanded={creditOpen}
                style={{
                  ...LABEL,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: creditOpen ? 8 : 0,
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {creditOpen ? "▾" : "▸"} Credit{" "}
                {credit?.credit || credit?.creator ? (
                  <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--t2)" }}>
                    — {credit.credit ?? credit.creator}
                  </span>
                ) : (
                  <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--t3)" }}>
                    — not set
                  </span>
                )}
              </button>
              {creditOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(
                    [
                      ["creator", "Creator", "Your name"],
                      ["credit", "Credit line", "Photo: Your Name / Agency"],
                      ["copyrightNotice", "Copyright", "© 2026 Your Name"],
                      ["usageTerms", "Usage terms", "Editorial use only"],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <label key={key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ fontSize: 10, color: "var(--t3)" }}>{label}</span>
                      <input
                        defaultValue={credit?.[key] ?? ""}
                        placeholder={placeholder}
                        disabled={!credit?.canEdit}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next !== (credit?.[key] ?? "")) void saveCredit({ [key]: next } as Partial<WorkspaceInfo>);
                        }}
                        style={{ ...INPUT, opacity: credit?.canEdit ? 1 : 0.5 }}
                      />
                    </label>
                  ))}
                  <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
                    {credit?.canEdit
                      ? "Saved for this workspace and printed in the page footer of every export."
                      : "Only the workspace owner can change these."}
                  </div>
                </div>
              )}
            </div>

            {phase === "error" && (
              <div style={{ fontSize: 11, color: "var(--red)" }} role="alert">
                {err}
                {jobId && <span style={{ color: "var(--t3)" }}> ({jobId.slice(0, 8)})</span>}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button onClick={onClose} style={{ ...seg(false), height: 34 }}>
                Cancel
              </button>
              <button
                onClick={start}
                disabled={count === 0}
                data-autofocus=""
                style={{
                  flex: 1,
                  height: 34,
                  border: 0,
                  background: count === 0 ? "var(--bd)" : "var(--ac)",
                  color: count === 0 ? "var(--t3)" : "#050505",
                  borderRadius: 2,
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: count === 0 ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >
                {phase === "error" ? "Try again" : isCsv ? "Export CSV" : isZip ? "Download ZIP" : "Export PDF"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
