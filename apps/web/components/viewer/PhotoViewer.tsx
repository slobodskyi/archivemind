"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, SyntheticEvent } from "react";
import { ASSET_LABELS, type AssetLabel, type LabelNames } from "@archivemind/shared";
import type { Photo } from "@/types";
import { useDialog } from "@/hooks/useDialog";
import { isRealSource, photoSrc, photoSrcMedium } from "@/lib/img";
import { LABEL_COLORS } from "@/lib/labels";
import { largePreviewUrls, mediumPreviewUrls, originalUrls, previewVersion } from "@/lib/preview-url-cache";
import { Z } from "@/lib/ui";
import type { Size } from "@/lib/viewer";
import {
  browserDecodes,
  formatBytes,
  planOriginal,
  type OriginalAnswer,
  type OriginalPlan,
} from "@/lib/viewer-originals";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DownloadIcon,
  FitIcon,
  InfoIcon,
} from "@/components/icons/icons";
import { usePanZoom } from "./usePanZoom";

interface PhotoViewerProps {
  photo: Photo | null;
  /** 0-based position in the sequence ←/→ walks, and its length. */
  index: number;
  count: number;
  /** The photos either side — their previews are warmed so a step is instant. */
  neighbors: Photo[];
  /** A dialog is open over the viewer (Download, a delete confirmation): the
   *  keyboard belongs to it until it closes. */
  suspended: boolean;
  labelNames: LabelNames;
  onNav: (dir: number) => void;
  onClose: () => void;
  onLabel: (label: AssetLabel | null) => void;
  onDelete: () => void;
  onInfo: () => void;
  onDownload: () => void;
}

/** Idle time before the bars fade out of the way of the photo. */
const CHROME_IDLE_MS = 2500;
/** How long a photo must stay on screen before its original is fetched on a
 *  desktop — arrowing through a burst must not pull a dozen originals. */
const ORIGINAL_DWELL_MS = 350;
/** The same for the 2048 px preview (ADR 0055) — shorter, since it is a few
 *  hundred KB rather than megabytes. */
const LARGE_DWELL_MS = 150;
/** Why the chip says there is no sharper copy (its tooltip). */
const NO_ORIGINAL_TITLE: Record<"not_stored" | "format" | "browser", string> = {
  not_stored: "The original stays in Google Drive or OneDrive and is not stored in the archive, so this preview is the sharpest copy here.",
  format: "The original's format (RAW, TIFF…) can't be shown in a browser, so this preview is the sharpest copy.",
  browser: "This browser can't display the original's format (HEIC shows in Safari), so this preview is the sharpest copy.",
};

/** Fullscreen photo viewer (ADR 0054). The drawer's preview is a fixed 220 px
 *  `cover` crop, so until this nothing in the app showed a whole photo larger
 *  than a tile. This shows it contained in the viewport, zooms to its loaded
 *  pixels, and walks the canvas's reading order — opened from the drawer's
 *  preview, the F key, or the right-click menu. It is an overlay, not a fifth
 *  view: it changes nothing about the canvas under it. */
export default function PhotoViewer(props: PhotoViewerProps) {
  if (!props.photo) return null;
  return <ViewerBody {...props} photo={props.photo} />;
}

function ViewerBody({
  photo,
  index,
  count,
  neighbors,
  suspended,
  labelNames,
  onNav,
  onClose,
  onLabel,
  onDelete,
  onInfo,
  onDownload,
}: PhotoViewerProps & { photo: Photo }) {
  // Focus trap + Escape (useDialog). Escape is refused while a dialog sits
  // over the viewer: that Escape belongs to the dialog, and closing both at
  // once would drop you on the canvas mid-download.
  const suspendedRef = useRef(suspended);
  useEffect(() => {
    suspendedRef.current = suspended;
  });
  const rootRef = useDialog<HTMLDivElement>(true, () => {
    if (!suspendedRef.current) onClose();
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  // ── Sources: thumb (already in the browser cache from the tile) → medium ──
  const real = isRealSource(photo.source);
  const notReady = real && !photo.src;
  const version = previewVersion(photo.src);
  const key = `${photo.id}|${version}`;
  const thumbUrl = real ? (photo.src ?? null) : photoSrc(photo, 480, 360);
  const cachedMedium = real && !photo.srcMedium && !notReady ? mediumPreviewUrls.peek(photo.id, version) : undefined;
  const [fetched, setFetched] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!real || notReady || photo.srcMedium || cachedMedium) return;
    let alive = true;
    void mediumPreviewUrls.get(photo.id, version).then((url) => {
      if (alive && url) setFetched({ key, url });
    });
    return () => {
      alive = false;
    };
  }, [real, notReady, photo.id, photo.srcMedium, version, key, cachedMedium]);
  const mediumUrl =
    photo.srcMedium ??
    cachedMedium ??
    (fetched?.key === key ? fetched.url : null) ??
    (real ? null : photoSrcMedium(photo, 1600, 1200));

  // ── The original — the third step (ADR 0054). Asked for after a short dwell
  //    on a desktop; on touch only at the first zoom, because a phone or iPad
  //    decoding a 48 MP frame it may never zoom into is what kills the tab; or
  //    by a click. An EDITED photo stays on its edit until "Original" is
  //    pressed: the edit exists only as rendered previews, and swapping in the
  //    unedited original unasked would quietly undo it on screen. ──
  const [coarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true,
  );
  const autoOriginal = real && !notReady && !photo.edited;
  const [asked, setAsked] = useState<{ key: string; explicit: boolean } | null>(null);
  const ask = asked?.key === key ? asked : null;
  useEffect(() => {
    if (!autoOriginal || coarse) return;
    const timer = window.setTimeout(
      () => setAsked((a) => (a?.key === key ? a : { key, explicit: false })),
      ORIGINAL_DWELL_MS,
    );
    return () => window.clearTimeout(timer);
  }, [autoOriginal, coarse, key]);
  const [fetchedOriginal, setFetchedOriginal] = useState<{ key: string; answer: OriginalAnswer } | null>(null);
  const originalAnswer =
    ask && real
      ? (originalUrls.peek(photo.id, "") ?? (fetchedOriginal?.key === key ? fetchedOriginal.answer : undefined))
      : undefined;
  useEffect(() => {
    if (!ask || !real || originalAnswer) return;
    let alive = true;
    void originalUrls.get(photo.id, "").then((answer) => {
      if (alive && answer) setFetchedOriginal({ key, answer });
    });
    return () => {
      alive = false;
    };
  }, [ask, real, originalAnswer, photo.id, key]);
  // A decode that fails (an older Safari and HEIC, an expired URL) falls back
  // to the preview quietly, and the chip says why.
  const [failedOriginal, setFailedOriginal] = useState<string | null>(null);
  const plan: OriginalPlan | null =
    ask && originalAnswer
      ? failedOriginal === key
        ? { kind: "none", why: "browser" }
        : planOriginal(originalAnswer, {
            canDecode: (mime) => browserDecodes(mime, navigator.userAgent),
            explicit: ask.explicit,
          })
      : null;
  const askOriginal = () => setAsked({ key, explicit: true });

  // ── The large preview (ADR 0055) — 2048 px, between medium and the original.
  //    It is what makes "fit" sharp on a retina screen for every photo the
  //    original cannot serve (Drive, OneDrive, RAW, HEIC outside WebKit, an
  //    edit), and on touch it is the fit step before the first zoom. A desktop
  //    whose original is about to load anyway skips it: two downloads of one
  //    photo for one look. The route answers null when there is nothing
  //    larger than medium, and for an edit only ever with the edit's own
  //    render. ──
  const [dwelt, setDwelt] = useState<string | null>(null);
  useEffect(() => {
    if (!real || notReady) return;
    const timer = window.setTimeout(() => setDwelt(key), LARGE_DWELL_MS);
    return () => window.clearTimeout(timer);
  }, [real, notReady, key]);
  const largeWanted =
    real && !notReady && dwelt === key && (!autoOriginal || coarse || (plan !== null && plan.kind !== "load"));
  const [fetchedLarge, setFetchedLarge] = useState<{ key: string; url: string | null } | null>(null);
  const largeAnswer = largeWanted
    ? (largePreviewUrls.peek(photo.id, version) ?? (fetchedLarge?.key === key ? fetchedLarge : undefined))
    : undefined;
  useEffect(() => {
    if (!largeWanted || largeAnswer) return;
    let alive = true;
    void largePreviewUrls.get(photo.id, version).then((answer) => {
      if (alive && answer) setFetchedLarge({ key, url: answer.url });
    });
    return () => {
      alive = false;
    };
  }, [largeWanted, largeAnswer, photo.id, version, key]);
  const [failedLarge, setFailedLarge] = useState<string | null>(null);
  const largeUrl = largeAnswer?.url && failedLarge !== key ? largeAnswer.url : null;

  // Natural sizes as each image lands. The best one sets the photo's shape and
  // what "100%" means; the tile's w/h stand in for the instant before.
  const [loaded, setLoaded] = useState<{ key: string; thumb?: Size; medium?: Size; large?: Size; original?: Size }>({
    key,
  });
  const sizes = loaded.key === key ? loaded : null;
  const estimate = useMemo(() => ({ w: photo.w, h: photo.h }), [photo.w, photo.h]);
  const originalSize = plan?.kind === "load" ? (sizes?.original ?? null) : null;
  const largeSize = largeUrl ? (sizes?.large ?? null) : null;
  const content = notReady ? null : (originalSize ?? largeSize ?? sizes?.medium ?? sizes?.thumb ?? estimate);
  const onImageLoad = (which: "thumb" | "medium" | "large" | "original") => (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (!img.naturalWidth || !img.naturalHeight) return;
    const size = { w: img.naturalWidth, h: img.naturalHeight };
    setLoaded((prev) => ({ ...(prev.key === key ? prev : { key }), [which]: size }));
  };

  // Warm the neighbours once this photo's own medium is on its way, so a step
  // is a cache hit rather than a fresh round trip.
  const neighborsRef = useRef(neighbors);
  useEffect(() => {
    neighborsRef.current = neighbors;
  });
  const neighborKey = neighbors.map((n) => `${n.id}|${previewVersion(n.src)}`).join(",");
  useEffect(() => {
    if (!mediumUrl) return;
    let alive = true;
    const warm: HTMLImageElement[] = [];
    for (const n of neighborsRef.current) {
      if (!isRealSource(n.source) || !n.src || n.srcMedium) continue;
      void mediumPreviewUrls.get(n.id, previewVersion(n.src)).then((url) => {
        if (!alive || !url) return;
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        warm.push(img);
      });
    }
    return () => {
      alive = false;
    };
  }, [neighborKey, mediumUrl]);

  // ── Chrome: visible on open and on mouse movement, out of the way when idle ──
  const [chrome, setChrome] = useState(true);
  const hold = useRef(false);
  const hideTimer = useRef<number | null>(null);
  const poke = useCallback(() => {
    setChrome(true);
    if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!hold.current) setChrome(false);
    }, CHROME_IDLE_MS);
  }, []);
  useEffect(() => {
    hideTimer.current = window.setTimeout(() => {
      if (!hold.current) setChrome(false);
    }, CHROME_IDLE_MS);
    return () => {
      if (hideTimer.current != null) window.clearTimeout(hideTimer.current);
    };
  }, []);
  const holdChrome = {
    onPointerEnter: () => {
      hold.current = true;
    },
    onPointerLeave: () => {
      hold.current = false;
      poke();
    },
  };

  const { zoomed, toggleCenter, zoomStep, handlers } = usePanZoom({
    stageRef,
    boxRef,
    labelRef,
    content,
    resetKey: photo.id,
    onSwipe: onNav,
    onTap: () => setChrome((c) => !c),
    onZoomIn: () => {
      if (coarse && autoOriginal) setAsked((a) => (a?.key === key ? a : { key, explicit: false }));
    },
  });

  // ── Browser fullscreen. The DOCUMENT goes fullscreen, not this overlay: a
  //    fullscreen element hides everything outside it, and Download's dialog
  //    and the delete's undo toast live outside it. ──
  // Read straight from `document`: the viewer only ever mounts in the browser
  // (nothing opens it during a server render). iPhone Safari has no element
  // fullscreen at all, and there the button is simply not drawn.
  const [canFullscreen] = useState(() => typeof document !== "undefined" && document.fullscreenEnabled === true);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== "undefined" && document.fullscreenElement != null,
  );
  const enteredFullscreen = useRef(false);
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      // Leave the browser the way we found it.
      if (enteredFullscreen.current && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
      return;
    }
    enteredFullscreen.current = true;
    void document.documentElement.requestFullscreen().catch(() => {
      enteredFullscreen.current = false;
    });
  }, []);

  // ── Keyboard. The workspace's own bindings stand down while the viewer is
  //    open (useWorkspace), so digits and Delete act on THIS photo only. ──
  const live = useRef({ suspended, onNav, onClose, onLabel, onDelete, onInfo, zoomStep, toggleFullscreen });
  useEffect(() => {
    live.current = { suspended, onNav, onClose, onLabel, onDelete, onInfo, zoomStep, toggleFullscreen };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const p = live.current;
      if (p.suspended || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key;
      if (k === "Escape") {
        e.preventDefault();
        p.onClose();
      } else if (k === "ArrowLeft" || k === "ArrowRight") {
        e.preventDefault();
        p.onNav(k === "ArrowLeft" ? -1 : 1);
      } else if (k === "+" || k === "=") {
        e.preventDefault();
        p.zoomStep(1);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        p.zoomStep(-1);
      } else if (e.repeat) {
        // Held keys repeat only for stepping and zooming: a held Delete must
        // not walk through the archive trashing every photo it passes.
      } else if (k === "f" || k === "F") {
        e.preventDefault();
        p.toggleFullscreen();
      } else if (k === "i" || k === "I") {
        e.preventDefault();
        p.onInfo();
      } else if (k === "Delete" || k === "Backspace") {
        e.preventDefault();
        p.onDelete();
      } else if (k.length === 1 && k >= "0" && k <= "7") {
        e.preventDefault();
        p.onLabel(k === "0" ? null : ASSET_LABELS[Number(k) - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The chip names the image on screen — and when no sharper one exists, says
  // so instead of letting a soft zoom read as a broken one.
  const noOriginal = plan?.kind === "none" ? plan.why : null;
  const preview = largeSize ?? sizes?.medium;
  const quality = notReady
    ? "Preview not ready"
    : !real
      ? "Preview"
      : originalSize
        ? `Original${photo.edited ? " · unedited" : ""} ${originalSize.w}×${originalSize.h}`
        : plan?.kind === "load"
          ? "Loading original…"
          : preview
            ? `${photo.edited && !ask ? "Edited · " : ""}Preview ${preview.w}×${preview.h}${
                noOriginal ? (noOriginal === "not_stored" ? " · no original" : " · original not viewable") : ""
              }`
            : "Loading…";
  const label = photo.label ?? null;
  const chromeStyle: CSSProperties = {
    opacity: chrome ? 1 : 0,
    pointerEvents: chrome ? "auto" : "none",
    transition: "opacity .2s ease",
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onPointerMove={(e) => {
        if (e.pointerType === "mouse") poke();
      }}
      // React events bubble through the component tree, not the DOM: keep the
      // viewer's presses away from whatever the workspace listens for.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.viewer,
        background: "#070707",
        color: "#fff",
        overscrollBehavior: "contain",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      <div
        ref={stageRef}
        tabIndex={-1}
        data-autofocus=""
        {...handlers}
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          touchAction: "none",
          outline: "none",
          cursor: zoomed ? "grab" : "zoom-in",
        }}
      >
        {/* Plain <img>, not next/image: presigned R2 URLs that change every
            half hour have nothing for an optimiser to cache, and the viewer
            needs each image's natural size the moment it decodes. */}
        <div ref={boxRef} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}>
          {thumbUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`t:${key}`}
              src={thumbUrl}
              alt=""
              draggable={false}
              decoding="async"
              onLoad={onImageLoad("thumb")}
              style={imageStyle}
            />
          )}
          {mediumUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`m:${key}`}
              src={mediumUrl}
              alt=""
              draggable={false}
              decoding="async"
              onLoad={onImageLoad("medium")}
              style={{ ...imageStyle, opacity: sizes?.medium ? 1 : 0, transition: "opacity .18s ease" }}
            />
          )}
          {largeUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`l:${key}`}
              src={largeUrl}
              alt=""
              draggable={false}
              decoding="async"
              onLoad={onImageLoad("large")}
              onError={() => setFailedLarge(key)}
              style={{ ...imageStyle, opacity: largeSize ? 1 : 0, transition: "opacity .18s ease" }}
            />
          )}
          {/* Keyed per photo, so stepping away unmounts it: one original
              alive at a time. */}
          {plan?.kind === "load" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`o:${key}`}
              src={plan.url}
              alt=""
              draggable={false}
              decoding="async"
              onLoad={onImageLoad("original")}
              onError={() => setFailedOriginal(key)}
              style={{ ...imageStyle, opacity: originalSize ? 1 : 0, transition: "opacity .18s ease" }}
            />
          )}
        </div>
        {notReady && (
          <div
            data-ph-unmask=""
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              fontSize: 12,
              color: "var(--t2)",
              letterSpacing: ".04em",
            }}
          >
            The preview is still being processed.
          </div>
        )}
      </div>

      <div className="am-viewer-bar" {...holdChrome} style={{ ...topBar, ...chromeStyle }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: "1 1 auto" }}>
          {label && (
            <span
              aria-label={labelNames[label] ?? label}
              title={labelNames[label] ?? label}
              style={{ width: 8, height: 8, flex: "none", borderRadius: 999, background: LABEL_COLORS[label] }}
            />
          )}
          <span
            style={{
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {photo.filename}
          </span>
          {count > 1 && index >= 0 && (
            <span data-ph-unmask="" style={{ fontSize: 11, color: "var(--t3)", flex: "none" }}>
              {index + 1} / {count}
            </span>
          )}
        </div>
        <div data-ph-unmask="" style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
          <span className="am-viewer-chip" title={noOriginal ? NO_ORIGINAL_TITLE[noOriginal] : undefined} style={chip}>
            {quality}
          </span>
          {plan?.kind === "ask" && (
            <button
              type="button"
              className="am-touch-target"
              onClick={askOriginal}
              title="Load the full-resolution original"
              style={barButton}
            >
              Original{plan.bytes != null ? ` · ${formatBytes(plan.bytes)}` : ""}
            </button>
          )}
          {photo.edited && real && !notReady && (
            <button
              type="button"
              className="am-touch-target"
              onClick={() => setAsked(ask ? null : { key, explicit: true })}
              aria-pressed={ask != null}
              title={ask ? "Back to the edit" : "Show the unedited original at full resolution"}
              style={{ ...barButton, color: ask ? "var(--ac)" : "#fff" }}
            >
              Original
            </button>
          )}
          <button
            type="button"
            className="am-touch-target"
            onClick={toggleCenter}
            title="Fit ⇄ zoom in — or double-click the photo"
            style={{ ...barButton, minWidth: 56 }}
          >
            <span ref={labelRef} />
          </button>
          <button type="button" className="am-touch-target" onClick={onInfo} aria-label="Details" title="Details (I)" style={barButton}>
            <InfoIcon />
          </button>
          <button
            type="button"
            className="am-touch-target"
            onClick={onDownload}
            aria-label="Download"
            title="Download"
            style={barButton}
          >
            <DownloadIcon />
          </button>
          {canFullscreen && (
            <button
              type="button"
              className="am-touch-target am-viewer-fullscreen"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              aria-pressed={isFullscreen}
              title={isFullscreen ? "Exit full screen (F)" : "Full screen (F)"}
              style={{ ...barButton, color: isFullscreen ? "var(--ac)" : "#fff" }}
            >
              <FitIcon width={14} height={14} />
            </button>
          )}
          <button type="button" className="am-touch-target" onClick={onClose} aria-label="Close" title="Close (Esc)" style={barButton}>
            <CloseIcon width={13} height={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="am-touch-target am-viewer-step"
            onClick={() => onNav(-1)}
            aria-label="Previous photo"
            title="Previous (←)"
            {...holdChrome}
            style={{ ...stepButton, left: 12, ...chromeStyle }}
          >
            <ChevronLeftIcon width={18} height={18} />
          </button>
          <button
            type="button"
            className="am-touch-target am-viewer-step"
            onClick={() => onNav(1)}
            aria-label="Next photo"
            title="Next (→)"
            {...holdChrome}
            style={{ ...stepButton, right: 12, ...chromeStyle }}
          >
            <ChevronRightIcon width={18} height={18} />
          </button>
        </>
      )}
    </div>
  );
}

const imageStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "contain",
  pointerEvents: "none",
  userSelect: "none",
};

const topBar: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  height: 56,
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "0 14px",
  background: "linear-gradient(rgba(0,0,0,.78), rgba(0,0,0,.42) 70%, rgba(0,0,0,0))",
};

const barButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: 30,
  minWidth: 30,
  padding: "0 8px",
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(10,10,10,.55)",
  color: "#fff",
  borderRadius: 2,
  fontFamily: "inherit",
  fontSize: 11,
  letterSpacing: ".04em",
  textTransform: "uppercase",
  cursor: "pointer",
  backdropFilter: "blur(8px)",
};

const chip: CSSProperties = {
  fontSize: 10,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--t2)",
  whiteSpace: "nowrap",
  marginRight: 4,
};

const stepButton: CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 40,
  height: 40,
  border: "1px solid rgba(255,255,255,.14)",
  background: "rgba(10,10,10,.55)",
  color: "#fff",
  borderRadius: 2,
  cursor: "pointer",
  backdropFilter: "blur(8px)",
};
