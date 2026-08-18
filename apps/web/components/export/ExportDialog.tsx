import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { EXPORT_MAX_ASSETS, type ArtboardSettings, type WorkspaceInfo } from "@archivemind/shared";
import type { Photo } from "@/types";
import Dialog, { DialogButton } from "@/components/modals/Dialog";
import {
  LANG_UI,
  STYLE_UI,
  bestCaptionPair,
  captionCoverage,
  captionStateFor,
  pdfPageCount,
  underLabel,
  type CaptionState,
} from "@/lib/export-plan";
import { isNonDefaultPageSetup, loadPrefs, savePrefs } from "@/lib/export-prefs";
import { photoSrc } from "@/lib/img";

interface ExportDialogProps {
  /** Asset ids in page order (openExportFor puts them in reading order). */
  assetIds: string[];
  /** The workspace's loaded photos — the dialog looks up the ones it exports. */
  photos: Photo[];
  /** Suggested document name — the current project's label. */
  defaultTitle?: string;
  /** Scopes the remembered page/caption preferences (see lib/export-prefs). */
  workspaceId: string;
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

const POLL_MS = 1500;
/** No status change for this long → offer Retry instead of spinning forever.
 *  Nothing in the system moves a `queued` job to `failed` (reapStaleJobs only
 *  rescues `running`), so a worker that never claims it would poll for ever. */
const STALL_MS = 5 * 60 * 1000;

const ENQUEUE_ERROR_COPY: Record<string, string> = {
  too_many_assets: `A download covers up to ${EXPORT_MAX_ASSETS} photos at a time. Deselect some and try again.`,
  no_matching_assets: "Those photos aren't available any more — they may be in Trash.",
  group_not_found: "That download source no longer exists.",
  unauthorized: "Your session expired. Reload the page and sign in again.",
  no_workspace: "No workspace found for your account.",
  export_backlog: "You already have downloads being prepared. Wait for those to finish and try again.",
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
/** A label inside a group (Language/Style under Captions) — one step quieter
 *  than the group's own LABEL so the hierarchy reads. */
const SUBLABEL: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--t3)",
  margin: "0 0 4px",
};
/** Announced, never shown. Inline rather than a `sr-only` class: this codebase
 *  uses no Tailwind utilities in components, so a first-ever one that missed
 *  content detection would render the status text visibly. */
const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** Selection / saved group → export dialog (ADR 0035). Configures the deliverable,
 *  POSTs /api/exports, follows the job's real progress, then offers the file.
 *
 *  It reports what the run will actually contain before the user commits: which
 *  photos are in it and in what order, which of them have no caption that will
 *  reach the page (answered by the worker's own `resolveCaptionText`, not a
 *  lookalike), and which have no preview yet. Any photo can be dropped from the
 *  run without touching the canvas selection.
 *
 *  Mounted only while open, so its state resets naturally each time (the parent
 *  gates it with `&&`). */
export default function ExportDialog({
  assetIds,
  photos,
  defaultTitle,
  workspaceId,
  onClose,
}: ExportDialogProps) {
  // Read once, lazily: the dialog is mount-gated so this runs on every open, and
  // localStorage in a render body would run on every render.
  const [{ prefs, stored }] = useState(() => loadPrefs(workspaceId));
  const [title, setTitle] = useState(defaultTitle ?? "");
  const [cover, setCover] = useState(prefs.cover);
  /** Workspace credit block — fetched lazily, edited here because the app has no
   *  settings page and this is the only place a byline matters. `null` means not
   *  loaded (or the load failed), which is NOT the same as "you may not edit". */
  const [credit, setCredit] = useState<WorkspaceInfo | null>(null);
  const [creditFailed, setCreditFailed] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [format, setFormat] = useState<ArtboardSettings["format"]>("pdf");
  const [zipContents, setZipContents] = useState<ArtboardSettings["zipContents"]>("originals");
  const [layout, setLayout] = useState(prefs.pageLayout);
  const [pageSize, setPageSize] = useState(prefs.pageSize);
  const [orientation, setOrientation] = useState(prefs.orientation);
  // Seeded from what the SELECTION actually has when there is no saved
  // preference: the schema default is en/agency, which on a Ukrainian archive is
  // the one pair that prints nothing. A saved preference always wins.
  const [seeded] = useState(() => {
    const chosen = { lang: prefs.captionLang, style: prefs.captionStyle };
    if (stored) return chosen; // an explicit choice is never overridden by a guess
    const inRun = new Set(assetIds);
    return bestCaptionPair(
      photos.filter((p) => inRun.has(p.id)),
      chosen,
    ) ?? chosen;
  });
  const [captionLang, setCaptionLang] = useState(seeded.lang);
  const [captionStyle, setCaptionStyle] = useState(seeded.style);
  const [inc, setInc] = useState(prefs.include);
  const [setupOpen, setSetupOpen] = useState(() => isNonDefaultPageSetup(prefs));
  const [dropped, setDropped] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("config");
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string>("");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  /** Facts about the finished run that must survive the poll — progressLabel is
   *  overwritten every 1.5s, so anything written there lived one tick. */
  const [outcome, setOutcome] = useState<{ rendered: number; requested: number } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const groupId = useId();

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
        if (!r.ok) throw new Error("not ok");
        const info = (await r.json()) as WorkspaceInfo;
        if (live) setCredit(info);
      } catch {
        // The credit block is optional — its absence must not block an export.
        // But it must not claim the caller is not the owner either.
        if (live) setCreditFailed(true);
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
  /** One noun, four call sites — they used to disagree. */
  const fmt = isCsv ? "CSV" : isZip ? "ZIP" : "PDF";

  const captionState = useCallback(
    (photo: Photo | undefined): CaptionState =>
      captionStateFor(photo, { isDoc, lang: captionLang, style: captionStyle }),
    [isDoc, captionLang, captionStyle],
  );

  const captionHint = useCallback(
    (state: CaptionState): string => {
      const pair = `${LANG_UI[captionLang]} · ${STYLE_UI[captionStyle]}`;
      if (!isDoc) {
        return state === "exact"
          ? `Has a ${STYLE_UI[captionStyle]} caption`
          : `No ${STYLE_UI[captionStyle]} caption — those cells will be empty`;
      }
      if (state === "exact") return `Has a ${pair} caption`;
      if (state === "fallback") return `No ${pair} caption — the closest one is used`;
      return `No caption in ${LANG_UI[captionLang]} — this one prints without`;
    },
    [isDoc, captionLang, captionStyle],
  );

  const noPreviewCount = useMemo(
    () => items.filter((i) => i.photo && !i.photo.srcMedium && !i.photo.src).length,
    [items],
  );

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (isZip) {
      // A zip ships bytes, so the only thing that can be missing is bytes.
      if (noPreviewCount > 0) {
        out.push(`${noPreviewCount} of ${count} have nothing stored yet — those are listed in README.txt.`);
      }
      return out;
    }
    if (isCsv) {
      // The empty cell is the deliverable — but picking the one style the archive
      // has none of yields three empty caption columns and no signal at all.
      const withStyle = items.filter(({ photo }) => captionState(photo) === "exact").length;
      if (count > 0 && withStyle === 0) {
        out.push(`No photo here has a ${STYLE_UI[captionStyle]} caption — those columns will be empty.`);
      }
      return out;
    }
    // PDF. `preview missing` applies whether or not captions are on.
    if (inc.caption) {
      let fallback = 0;
      let none = 0;
      for (const { photo } of items) {
        const state = captionState(photo);
        if (state === "fallback") fallback += 1;
        if (state === "none") none += 1;
      }
      const pair = `${LANG_UI[captionLang]} · ${STYLE_UI[captionStyle]}`;
      if (fallback > 0) {
        out.push(
          `${fallback} of ${count} have no ${pair} caption — those use the closest one there is (English of the same style, then any caption in that language).`,
        );
      }
      if (none > 0) out.push(`${none} of ${count} have no caption at all and print without one.`);
    }
    if (noPreviewCount > 0) {
      out.push(
        `${noPreviewCount} of ${count} have no preview yet — those print as a grey box with the filename instead of the photo.`,
      );
    }
    return out;
  }, [items, count, isCsv, isZip, inc.caption, captionStyle, captionLang, captionState, noPreviewCount]);

  const options: ArtboardSettings = useMemo(
    () => ({ format, zipContents, cover, pageLayout: layout, pageSize, orientation, captionLang, captionStyle, include: inc }),
    [format, zipContents, cover, layout, pageSize, orientation, captionLang, captionStyle, inc],
  );

  const under = useMemo(() => underLabel(inc), [inc]);

  const subtitle = useMemo(() => {
    if (isCsv) return "one row each · captions in EN, UK and RU";
    if (isZip) {
      return `${zipContents === "originals" ? "original files" : "web-size images"} · captions.csv included`;
    }
    const pages = pdfPageCount(count, cover, layout);
    if (pages === null) return `${under} · 2 per row${cover ? " · plus a cover page" : ""}`;
    return `${under} · ${pages} ${pages === 1 ? "page" : "pages"}${cover ? " incl. cover" : ""}`;
  }, [isCsv, isZip, zipContents, layout, under, count, cover]);

  const start = useCallback(async () => {
    setPhase("working");
    setErr("");
    setProgress(0);
    setProgressLabel(null);
    setOutcome(null);
    // A stale id on an enqueue failure points at an unrelated run — and the copy
    // asks the user to send it to us.
    setJobId(null);
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
      const requested = ids.length;

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
            attempts?: number;
          };
          // Deliberately NOT keyed on status: a failing job flips
          // running→queued→running on every retry, and counting that as movement
          // is what let a broken export sit on "Preparing export" for twenty
          // minutes instead of surfacing the failure.
          const seen = `${j.progress ?? 0}:${j.doneItems ?? ""}:${j.attempts ?? 0}`;
          if (seen !== lastSeen) {
            lastSeen = seen;
            lastChange = Date.now();
          }
          if (typeof j.progress === "number") setProgress(j.progress);
          // attempts increments at claim time, so >1 means an earlier run failed.
          setProgressLabel(
            (j.attempts ?? 0) > 1
              ? `Retrying after a failure — attempt ${j.attempts} of 3`
              : j.progressLabel || null,
          );
          // total_items is what the WORKER collected, after it re-filtered for
          // active assets — the only count that matches the delivered file.
          if (typeof j.totalItems === "number" && j.totalItems > 0) {
            setOutcome({ rendered: j.totalItems, requested });
          }

          if (j.status === "done" && j.url) {
            stopPoll();
            // Remembered only on success — settings that produced a failure are
            // not worth carrying into the next export.
            savePrefs(workspaceId, {
              pageLayout: layout,
              pageSize,
              orientation,
              captionLang,
              captionStyle,
              include: inc,
              cover,
            });
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
                ? "This download is still waiting for the render worker. It may be offline — try again in a moment."
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
  }, [ids, title, options, stopPoll, workspaceId, layout, pageSize, orientation, captionLang, captionStyle, inc, cover]);

  // Three shapes, because these are three different kinds of control and they
  // used to be pixel-identical: a one-of-N choice, an on/off toggle and a way
  // out of the dialog all rendered as the same accent-bordered segment. Every
  // treatment below is lifted from a pattern already shipping in this repo.

  /** The mode switch. Deliberately the heaviest thing in the dialog — it decides
   *  which of the groups below exist at all. */
  const modeChip = (active: boolean): React.CSSProperties => ({
    flex: 1,
    height: 32,
    border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`,
    background: active ? "color-mix(in srgb, var(--ac) 14%, transparent)" : "transparent",
    color: active ? "var(--ac)" : "var(--t2)",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  });

  /** One-of-N, in a recessed track (PhotoDrawer's caption style picker). The
   *  track is the group; the raised item is the answer. */
  const TRACK: React.CSSProperties = {
    display: "flex",
    gap: 2,
    background: "var(--bg-in)",
    borderRadius: 2,
    padding: 2,
  };
  const trackBtn = (active: boolean, disabled = false): React.CSSProperties => ({
    flex: 1,
    height: 26,
    border: 0,
    borderRadius: 2,
    fontSize: 11.5,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: active ? "var(--bg-el)" : "transparent",
    color: active ? "#fff" : "var(--t2b)",
  });

  /** A boolean. Hugs its label and carries a check, so it never reads as one
   *  half of a choice the way "No cover | Add cover" did. */
  const chip = (active: boolean): React.CSSProperties => ({
    height: 28,
    padding: "0 10px",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`,
    background: active ? "color-mix(in srgb, var(--ac) 14%, transparent)" : "transparent",
    color: active ? "var(--ac)" : "var(--t2)",
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: "inherit",
  });

  /** The collapsed-group header, shared by Page setup and Credit. */
  const disclosure = (open: boolean, marginBottom: number): React.CSSProperties => ({
    ...LABEL,
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: open ? marginBottom : 0,
    background: "transparent",
    border: 0,
    padding: 0,
    cursor: "pointer",
    fontFamily: "inherit",
  });
  const SUMMARY: React.CSSProperties = {
    fontWeight: 400,
    textTransform: "none",
    letterSpacing: 0,
    color: "var(--t2)",
  };

  const dot = (state: CaptionState): React.CSSProperties => ({
    width: 6,
    height: 6,
    borderRadius: 999,
    flex: "0 0 auto",
    background: state === "exact" ? "var(--ac)" : state === "fallback" ? "#e0a33c" : "var(--bd)",
  });

  /** Announced once per phase, for people who cannot see the bar move. */
  const status =
    phase === "working"
      ? `Building your ${fmt}.`
      : phase === "ready"
        ? `Your ${fmt} is ready to download.`
        : phase === "error"
          ? err
          : "";

  const shortfall = outcome && outcome.rendered < outcome.requested ? outcome : null;

  /** The photos actually in the run — used for caption coverage counts. */
  const runPhotos = useMemo(() => items.map((i) => i.photo), [items]);

  /** Names every value it is hiding, so the collapsed group is a summary rather
   *  than a mystery. */
  const setupSummary = useMemo(
    () =>
      [
        pageSize,
        orientation,
        layout === "one_per_page" ? "one per page" : "grid",
        cover ? "cover page" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    [pageSize, orientation, layout, cover],
  );

  const footer =
    phase === "ready" && url ? (
      <>
        <DialogButton onClick={onClose}>Close</DialogButton>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-autofocus=""
          style={{
            flex: 2,
            minWidth: 0,
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
          Download {fmt}
        </a>
      </>
    ) : phase === "working" ? null : (
      <>
        <DialogButton onClick={onClose}>Cancel</DialogButton>
        <DialogButton variant="primary" data-autofocus="" onClick={start} disabled={count === 0}>
          {phase === "error" ? "Try again" : `Download ${fmt}`}
        </DialogButton>
      </>
    );

  return (
    <Dialog
      open
      size="m"
      title={`Download as ${fmt}`}
      subtitle={`${count} ${count === 1 ? "photo" : "photos"} · ${subtitle}`}
      busy={phase === "working"}
      refocusKey={phase}
      onClose={onClose}
      footer={footer}
      footerSeparated={phase !== "ready" && phase !== "working"}
    >
      <div style={SR_ONLY} role="status" aria-live="polite">
        {status}
      </div>

      {phase === "ready" && url ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: "var(--t2)" }}>Your {fmt} is ready.</div>
          {shortfall && (
            <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
              {shortfall.rendered} of {shortfall.requested} photos made it in — the rest are no longer available.
            </div>
          )}
        </div>
      ) : phase === "working" ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
            tabIndex={-1}
            data-autofocus=""
          >
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
            {shortfall && (
              <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
                {shortfall.rendered} of {shortfall.requested} photos made it in — the rest are no longer available.
              </div>
            )}
            <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
              This stays open until the render finishes — the download appears right here.
            </div>
          </div>
        ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* FORMAT FIRST: it decides which groups below exist at all and
                  rewrites the title, the list heading and the CTA. It used to
                  render third — after a page manifest and a document name that
                  a CSV retroactively makes meaningless. */}
              <div>
                <div style={LABEL} id={`${groupId}-format`}>
                  Format
                </div>
                <div style={{ display: "flex", gap: 6 }} role="group" aria-labelledby={`${groupId}-format`}>
                  <button style={modeChip(isDoc)} aria-pressed={isDoc} onClick={() => setFormat("pdf")}>
                    PDF document
                  </button>
                  <button style={modeChip(isCsv)} aria-pressed={isCsv} onClick={() => setFormat("captions_csv")}>
                    Captions CSV
                  </button>
                  <button style={modeChip(isZip)} aria-pressed={isZip} onClick={() => setFormat("zip")}>
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
                    <span style={SR_ONLY} id={`${groupId}-zip`}>
                      What the archive contains
                    </span>
                    <div style={TRACK} role="group" aria-labelledby={`${groupId}-zip`}>
                      <button
                        style={trackBtn(zipContents === "originals")}
                        aria-pressed={zipContents === "originals"}
                        onClick={() => setZipContents("originals")}
                      >
                        Originals
                      </button>
                      <button
                        style={trackBtn(zipContents === "web")}
                        aria-pressed={zipContents === "web"}
                        onClick={() => setZipContents("web")}
                      >
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

              {assetIds.length > 0 && (
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
                    {items.length === 0 && (
                      <div style={{ padding: "10px 8px", fontSize: 11, color: "var(--t3)" }}>
                        Every photo has been removed from this download.
                      </div>
                    )}
                    {items.map(({ id, photo }, i) => {
                      const state = captionState(photo);
                      const last = items.length === 1;
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
                            loading="lazy"
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
                          {(inc.caption || !isDoc) && <span style={dot(state)} title={captionHint(state)} />}
                          <button
                            onClick={() => setDropped((prev) => new Set(prev).add(id))}
                            disabled={last}
                            title={last ? "A download needs at least one photo" : "Remove from this download"}
                            aria-label={`Remove ${photo?.filename ?? id} from this download`}
                            style={{
                              width: 18,
                              height: 18,
                              flex: "0 0 auto",
                              border: 0,
                              background: "transparent",
                              color: "var(--t3)",
                              cursor: last ? "not-allowed" : "pointer",
                              opacity: last ? 0.4 : 1,
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
                  {/* The same dots the rows carry, spelled out — their meaning
                      used to live in a hover title nobody discovers. */}
                  {(inc.caption || !isDoc) && items.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 6 }}>
                      {(isDoc
                        ? ([
                            ["exact", `has ${LANG_UI[captionLang]} · ${STYLE_UI[captionStyle]}`],
                            ["fallback", "closest used"],
                            ["none", "prints without"],
                          ] as const)
                        : ([
                            ["exact", `has ${STYLE_UI[captionStyle]}`],
                            ["none", "empty cell"],
                          ] as const)
                      ).map(([state, label]) => (
                        <span key={state} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--t3)" }}>
                          <span style={dot(state)} />
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
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

              {/* CAPTIONS: the on/off chips come FIRST and the language and style
                  are nested under them. They used to be the other way round, so
                  the lang buttons were greyed out by a toggle 32px BELOW them. */}
              <div>
                <div style={LABEL}>Captions</div>
                {isDoc && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {(
                      [
                        ["caption", "Caption"],
                        ["title", "Filename"],
                        ["exif", "EXIF"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        style={chip(inc[key])}
                        aria-pressed={inc[key]}
                        onClick={() => setInc((p) => ({ ...p, [key]: !p[key] }))}
                      >
                        <span aria-hidden="true">{inc[key] ? "✓" : "+"}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {isDoc && !inc.caption ? (
                  <div style={{ fontSize: 10.5, color: "var(--t3)" }}>
                    Captions are off — turn Caption on to pick a language and style.
                  </div>
                ) : (
                  <>
                    {isDoc ? (
                      <>
                      <div style={SUBLABEL} id={`${groupId}-caption`}>
                        Language
                      </div>
                      <div style={{ ...TRACK, marginBottom: 8 }} role="group" aria-labelledby={`${groupId}-caption`}>
                        {LANGS.map((l) => {
                          const n = captionCoverage(runPhotos, l.key, captionStyle);
                          return (
                            <button
                              key={l.key}
                              style={trackBtn(captionLang === l.key)}
                              aria-pressed={captionLang === l.key}
                              title={`${LANG_UI[l.key]} · ${STYLE_UI[captionStyle]}: ${n} of ${count}`}
                              onClick={() => setCaptionLang(l.key)}
                            >
                              {l.label}
                            </button>
                          );
                        })}
                      </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 10.5, color: "var(--t3)", marginBottom: 8 }}>
                        All three languages are included as their own columns.
                      </div>
                    )}
                    <div style={SUBLABEL} id={`${groupId}-style`}>
                      Style
                    </div>
                    <div style={TRACK} role="group" aria-labelledby={`${groupId}-style`}>
                      {STYLES.map((st) => (
                        <button
                          key={st.key}
                          style={trackBtn(captionStyle === st.key)}
                          aria-pressed={captionStyle === st.key}
                          onClick={() => setCaptionStyle(st.key)}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* PAGE SETUP: four controls almost nobody changes twice, folded
                  behind a summary that NAMES their current values — so nothing
                  is hidden silently. Auto-expands when anything is non-default. */}
              {isDoc && (
                <div>
                  <button onClick={() => setSetupOpen((v) => !v)} aria-expanded={setupOpen} style={disclosure(setupOpen, 8)}>
                    {setupOpen ? "▾" : "▸"} Page setup <span style={SUMMARY}>— {setupSummary}</span>
                  </button>
                  {setupOpen && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={TRACK} role="group" aria-labelledby={`${groupId}-layout`}>
                        <span style={SR_ONLY} id={`${groupId}-layout`}>
                          Page layout
                        </span>
                        <button
                          style={trackBtn(layout === "one_per_page")}
                          aria-pressed={layout === "one_per_page"}
                          onClick={() => setLayout("one_per_page")}
                        >
                          One per page
                        </button>
                        <button style={trackBtn(layout === "grid")} aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}>
                          Grid
                        </button>
                      </div>
                      <div style={TRACK} role="group" aria-labelledby={`${groupId}-size`}>
                        <span style={SR_ONLY} id={`${groupId}-size`}>
                          Page size
                        </span>
                        <button style={trackBtn(pageSize === "A4")} aria-pressed={pageSize === "A4"} onClick={() => setPageSize("A4")}>
                          A4
                        </button>
                        <button
                          style={trackBtn(pageSize === "Letter")}
                          aria-pressed={pageSize === "Letter"}
                          onClick={() => setPageSize("Letter")}
                        >
                          Letter
                        </button>
                      </div>
                      <div style={TRACK} role="group" aria-labelledby={`${groupId}-orient`}>
                        <span style={SR_ONLY} id={`${groupId}-orient`}>
                          Orientation
                        </span>
                        <button
                          style={trackBtn(orientation === "portrait")}
                          aria-pressed={orientation === "portrait"}
                          onClick={() => setOrientation("portrait")}
                        >
                          Portrait
                        </button>
                        <button
                          style={trackBtn(orientation === "landscape")}
                          aria-pressed={orientation === "landscape"}
                          onClick={() => setOrientation("landscape")}
                        >
                          Landscape
                        </button>
                      </div>
                      <div>
                        <button style={chip(cover)} aria-pressed={cover} onClick={() => setCover((v) => !v)}>
                          <span aria-hidden="true">{cover ? "✓" : "+"}</span>
                          Cover page
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {isDoc && (
                <div>
                  <button onClick={() => setCreditOpen((v) => !v)} aria-expanded={creditOpen} style={disclosure(creditOpen, 8)}>
                    {creditOpen ? "▾" : "▸"} Credit{" "}
                    <span style={credit?.credit || credit?.creator ? SUMMARY : { ...SUMMARY, color: "var(--t3)" }}>
                      — {credit?.credit ?? credit?.creator ?? "not set"}
                    </span>
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
                        {creditFailed
                          ? "Couldn't load the credit block — reload the page to try again."
                          : credit?.canEdit
                            ? "The credit line (or Creator) prints in the footer of every page. Copyright and Usage terms print on the cover — turn Cover page on to include them."
                            : credit
                              ? "Only the workspace owner can change these."
                              : "Loading…"}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {phase === "error" && (
                <div style={{ fontSize: 11, color: "var(--red)" }}>
                  {err}
                  {jobId && <span style={{ color: "var(--t3)" }}> ({jobId.slice(0, 8)})</span>}
                </div>
              )}
            </div>
        )}
    </Dialog>
  );
}
