"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_LABEL_NAMES } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import { NO_SHARE_DETAILS, type ShareDetails } from "@/lib/project-shares";
import {
  activeShareFilters,
  EMPTY_SHARE_FACETS,
  filteredShareTotal,
  shareAssetsHref,
  shareDownloadsHref,
  shareMediaHref,
  type ProjectShareDownloadStatus,
  type ProjectShareFacets,
  type ProjectShareFile,
  type ProjectShareFilter,
  type ProjectSharePage,
} from "@/lib/project-share-public";
import ShareFilterBar from "./ShareFilterBar";
import ShareLightbox from "./ShareLightbox";
import { MONO, shareButton as button, sharePrimaryButton as primaryButton } from "./share-ui";

/** The export job's own cap: one ZIP carries at most this many files. */
const ZIP_MAX_FILES = 500;
const POLL_MS = 2_000;

type ZipState =
  | { phase: "idle" }
  | { phase: "working"; progress: number }
  | { phase: "ready" }
  | { phase: "error"; message: string };

function formatBytes(bytes: number | null): string | null {
  if (bytes === null) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** A Drive or OneDrive file has no original in this archive: what downloads
 *  is its 1024px web preview, and the card says so (ADR 0051 §7). */
function qualityLabel(file: ProjectShareFile): string {
  const size = file.hasOriginal ? formatBytes(file.byteSize) : null;
  return file.hasOriginal
    ? ["Original file", size].filter(Boolean).join(" · ")
    : "Web-size · up to 1024px";
}

function zipErrorCopy(error: string | null | undefined): string {
  if (error === "busy") return "A ZIP for this link is already being prepared. Try again in a minute.";
  if (error === "limit") return "This link has made its ZIPs for today. Download files one by one, or try tomorrow.";
  if (error === "too_large") return "That selection is too large for one ZIP. Select fewer files.";
  if (error === "not_found") return "This link is no longer available.";
  return "The ZIP could not be prepared. Try again.";
}

function FileCard({
  token,
  file,
  details,
  selected,
  onToggle,
  onOpen,
}: {
  token: string;
  file: ProjectShareFile;
  details: ShareDetails;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const label = details.labels ? file.label : null;
  const caption = details.caption ? file.caption : null;
  return (
    <div
      className="public-share-file-card"
      style={selected ? { borderColor: "var(--ac)" } : undefined}
    >
      <div className="public-share-file-preview" style={{ position: "relative" }}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${file.filename}`}
          style={{ display: "block", width: "100%", height: "100%", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
        >
          {file.hasPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shareMediaHref(token, file.id, "thumb")}
              alt=""
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="public-share-missing-media" role="img" aria-label="Preview unavailable" style={{ height: "100%" }}>
              Preview unavailable
            </div>
          )}
        </button>
        {label ? (
          <span
            role="img"
            aria-label={`${DEFAULT_LABEL_NAMES[label]} label`}
            title={`${DEFAULT_LABEL_NAMES[label]} label`}
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              width: 11,
              height: 11,
              borderRadius: "50%",
              background: LABEL_COLORS[label],
              boxShadow: "0 0 0 2px rgba(8,8,8,.78)",
            }}
          />
        ) : null}
        <label
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 8px",
            borderRadius: 2,
            background: "rgba(8,8,8,.78)",
            color: "var(--t1)",
            fontFamily: MONO,
            fontSize: 9,
            cursor: "pointer",
          }}
        >
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${file.filename}`} />
          Select
        </label>
      </div>
      <div className="public-share-file-meta">
        <strong title={file.filename}>{file.filename}</strong>
        <span>{qualityLabel(file)}</span>
        {caption ? (
          <p
            lang={details.caption?.lang}
            style={{
              margin: "8px 0 0",
              color: "var(--t1)",
              fontSize: 10,
              lineHeight: 1.5,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {caption}
          </p>
        ) : null}
        <a href={shareMediaHref(token, file.id, "original")} rel="noreferrer" style={{ ...button, fontSize: 9.5 }}>
          <span aria-hidden="true">↓</span>
          {file.hasOriginal ? "Download original" : "Download web-size"}
        </a>
      </div>
    </div>
  );
}

/** The files a download link carries (ADR 0051): the first page arrives
 *  server-rendered, later pages over `GET /s/{token}/assets`, and a selection
 *  leaves as one ZIP built by the ordinary export job. Every picture and file
 *  is a `/s/{token}/media/…` path — no signed URL is ever part of the page. */
export default function ProjectShareFiles({
  token,
  initialPage,
  fileCount,
  details = NO_SHARE_DETAILS,
  facets = EMPTY_SHARE_FACETS,
}: {
  token: string;
  initialPage: ProjectSharePage;
  fileCount: number;
  /** What the link shows beside its files (ADR 0053 §3). */
  details?: ShareDetails;
  /** The filter row's values and counts, server-rendered with the first page. */
  facets?: ProjectShareFacets;
}) {
  const [files, setFiles] = useState(initialPage.files);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<ProjectShareFilter>({});
  const [filtering, setFiltering] = useState(false);
  const [filterError, setFilterError] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [zip, setZip] = useState<ZipState>({ phase: "idle" });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The newest filter request wins: a slow answer for a filter the recipient
  // already left must not overwrite the one they are looking at.
  const filterRequest = useRef(0);
  const filtered = activeShareFilters(filter) > 0;
  const total = filteredShareTotal(filter, facets, fileCount);

  useEffect(() => () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
  }, []);

  async function loadMore() {
    if (!cursor || loading) return;
    const request = filterRequest.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await fetch(shareAssetsHref(token, cursor, filter), { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as ProjectSharePage;
      // The filter changed while this page was on its way: it belongs to a
      // list that is no longer on screen.
      if (request !== filterRequest.current) return;
      setFiles((previous) => {
        const seen = new Set(previous.map((file) => file.id));
        return [...previous, ...page.files.filter((file) => !seen.has(file.id))];
      });
      setCursor(page.nextCursor);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function applyFilter(next: ProjectShareFilter) {
    const request = ++filterRequest.current;
    setFilter(next);
    setFiltering(true);
    setFilterError(false);
    setViewing(null);
    try {
      const response = await fetch(shareAssetsHref(token, null, next), { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as ProjectSharePage;
      if (request !== filterRequest.current) return;
      setFiles(page.files);
      setCursor(page.nextCursor);
      setLoadError(false);
      // The selection narrows to what is still on screen, so "Download N"
      // never carries a file the recipient can no longer see (ADR 0040's rule
      // for a canvas filter, applied to the page).
      const visible = new Set(page.files.map((file) => file.id));
      setSelected((previous) => new Set([...previous].filter((id) => visible.has(id))));
    } catch {
      if (request === filterRequest.current) setFilterError(true);
    } finally {
      if (request === filterRequest.current) setFiltering(false);
    }
  }

  const closeViewer = useCallback(() => setViewing(null), []);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < ZIP_MAX_FILES) next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(files.slice(0, ZIP_MAX_FILES).map((file) => file.id)));
  }

  async function poll(jobId: string) {
    const href = shareDownloadsHref(token, jobId);
    try {
      // The finished job answers with a 302 to the archive. Not followed here
      // (it is cross-origin); the page navigates to the same URL instead, so
      // the browser downloads it as an attachment.
      const response = await fetch(href, { cache: "no-store", redirect: "manual" });
      if (response.type === "opaqueredirect") {
        setZip({ phase: "ready" });
        window.location.assign(href);
        return;
      }
      if (!response.ok) {
        setZip({ phase: "error", message: zipErrorCopy("not_found") });
        return;
      }
      const status = (await response.json()) as ProjectShareDownloadStatus;
      if (status.status === "failed" || status.status === "canceled") {
        setZip({ phase: "error", message: zipErrorCopy(status.error) });
        return;
      }
      setZip({ phase: "working", progress: status.progress });
    } catch {
      // A dropped poll is not a failed job; ask again on the next tick.
    }
    pollTimer.current = setTimeout(() => void poll(jobId), POLL_MS);
  }

  async function downloadZip() {
    if (!selected.size || zip.phase === "working") return;
    // Keep the page's order, not the order the boxes were ticked in.
    const assetIds = files.filter((file) => selected.has(file.id)).map((file) => file.id);
    setZip({ phase: "working", progress: 0 });
    try {
      const response = await fetch(shareDownloadsHref(token), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetIds }),
      });
      const body = (await response.json().catch(() => ({}))) as { jobId?: string; error?: string };
      if (!response.ok || !body.jobId) {
        setZip({ phase: "error", message: zipErrorCopy(response.status === 404 ? "not_found" : body.error) });
        return;
      }
      void poll(body.jobId);
    } catch {
      setZip({ phase: "error", message: zipErrorCopy(null) });
    }
  }

  const zipLabel = zip.phase === "working"
    ? `Preparing ZIP · ${zip.progress}%`
    : selected.size
      ? `Download ${selected.size} as ZIP`
      : "Select files for a ZIP";

  return (
    <section id="shared-files" className="public-share-files" aria-labelledby="shared-files-title" style={{ marginTop: 56 }}>
      <div className="public-share-files-lead">
        <div>
          <div className="public-share-kicker">Files</div>
          <h2 id="shared-files-title">
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </h2>
        </div>
        <p>
          Download any file on its own, or select up to {ZIP_MAX_FILES} and take them as one ZIP.
          Files imported from Google Drive or OneDrive download at web size.
        </p>
      </div>

      <ShareFilterBar
        details={details}
        facets={facets}
        filter={filter}
        busy={filtering}
        onChange={(next) => void applyFilter(next)}
      />
      {filtered || filterError ? (
        <div role="status" style={{ marginTop: 12, color: "var(--t2)", fontSize: 10 }}>
          {filterError
            ? "Could not apply that filter. Try again."
            : filtering
              ? "Filtering…"
              : total !== null
                ? `${total.toLocaleString("en-US")} of ${fileCount.toLocaleString("en-US")} ${fileCount === 1 ? "file" : "files"} match`
                : `${files.length.toLocaleString("en-US")}${cursor ? "+" : ""} ${files.length === 1 && !cursor ? "file matches" : "files match"}`}
        </div>
      ) : null}

      {files.length ? (
        <div
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 22 }}
          aria-live="polite"
        >
          {/* Acts on the files on screen — under a filter, the filtered set —
              and says how many before it is pressed. */}
          <button type="button" style={button} onClick={selected.size ? () => setSelected(new Set()) : selectAll}>
            {selected.size
              ? `Clear selection (${selected.size})`
              : `Select ${Math.min(files.length, ZIP_MAX_FILES)}${filtered ? " matching" : ""}`}
          </button>
          <button
            type="button"
            style={{ ...primaryButton, opacity: selected.size && zip.phase !== "working" ? 1 : 0.45 }}
            disabled={!selected.size || zip.phase === "working"}
            onClick={() => void downloadZip()}
          >
            <span aria-hidden="true">↓</span>
            {zipLabel}
          </button>
          {zip.phase === "ready" ? (
            <span style={{ color: "var(--t2)", fontSize: 10 }}>Your ZIP is downloading.</span>
          ) : null}
          {zip.phase === "error" ? (
            <span role="alert" style={{ color: "var(--t2)", fontSize: 10 }}>{zip.message}</span>
          ) : null}
        </div>
      ) : (
        <div className="public-share-empty" style={{ marginTop: 28 }}>
          {filtered ? "No files match this filter." : "This project has no files yet."}
        </div>
      )}

      <div className="public-share-file-grid">
        {files.map((file) => (
          <FileCard
            key={file.id}
            token={token}
            file={file}
            details={details}
            selected={selected.has(file.id)}
            onToggle={() => toggle(file.id)}
            onOpen={() => setViewing(files.indexOf(file))}
          />
        ))}
      </div>

      {viewing !== null && files[viewing] ? (
        <ShareLightbox
          token={token}
          files={files}
          index={viewing}
          details={details}
          onClose={closeViewer}
          onStep={setViewing}
          onTag={(tag) => {
            setViewing(null);
            void applyFilter({ ...filter, tag });
          }}
        />
      ) : null}

      {cursor ? (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 28 }}>
          <button type="button" style={button} disabled={loading} onClick={() => void loadMore()}>
            {loading ? "Loading…" : total !== null ? `Show more (${files.length} of ${total})` : "Show more"}
          </button>
          {loadError ? <span role="alert" style={{ color: "var(--t2)", fontSize: 10 }}>Could not load more files.</span> : null}
        </div>
      ) : null}
    </section>
  );
}
