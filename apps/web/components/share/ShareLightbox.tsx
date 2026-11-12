"use client";

import { useEffect, useRef } from "react";
import { CAPTION_LANG_NAMES, DEFAULT_LABEL_NAMES } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import type { ShareDetails } from "@/lib/project-shares";
import { shareMediaHref, type ProjectShareFile } from "@/lib/project-share-public";
import { CAPTION_STYLE_TITLES } from "@/lib/share-scope";
import { MONO, shareButton, shareChip } from "./share-ui";

/** One file, large (ADR 0053): the 1024px medium preview through the same
 *  token-checked media path the grid uses, and beside it exactly the details
 *  the link shows — the colour, the one caption, the tag names. ←/→ walk the
 *  files on the page (the filtered set), Esc closes, and a tag narrows the
 *  page to it. */
export default function ShareLightbox({
  token,
  files,
  index,
  details,
  onClose,
  onStep,
  onTag,
}: {
  token: string;
  files: readonly ProjectShareFile[];
  index: number;
  details: ShareDetails;
  onClose: () => void;
  onStep: (index: number) => void;
  onTag: (tag: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const file = files[index];
  const hasPrev = index > 0;
  const hasNext = index < files.length - 1;

  useEffect(() => {
    // Focus moves in on open and back to whatever opened it on close.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowLeft" && hasPrev) onStep(index - 1);
      else if (event.key === "ArrowRight" && hasNext) onStep(index + 1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, hasPrev, hasNext, onClose, onStep]);

  if (!file) return null;
  const label = details.labels ? file.label : null;
  const tags = details.tags ? file.tags ?? [] : [];
  const caption = details.caption ? file.caption : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.filename}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 20,
        display: "grid",
        background: "rgba(4,4,4,.97)",
        fontFamily: MONO,
      }}
      className="share-lightbox"
    >
      <div style={{ position: "relative", minWidth: 0, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        {file.hasPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={file.id}
            src={shareMediaHref(token, file.id, "medium")}
            alt={file.filename}
            decoding="async"
            referrerPolicy="no-referrer"
            style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", display: "block" }}
          />
        ) : (
          <div className="public-share-missing-media" role="img" aria-label="Preview unavailable" style={{ width: "min(480px, 100%)", height: 320 }}>
            Preview unavailable
          </div>
        )}
        <button
          type="button"
          aria-label="Previous file"
          disabled={!hasPrev}
          onClick={() => onStep(index - 1)}
          style={{ ...shareButton, position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", opacity: hasPrev ? 1 : 0.3 }}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Next file"
          disabled={!hasNext}
          onClick={() => onStep(index + 1)}
          style={{ ...shareButton, position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", opacity: hasNext ? 1 : 0.3 }}
        >
          →
        </button>
      </div>

      <aside
        className="share-lightbox-aside"
        style={{
          minHeight: 0,
          overflowY: "auto",
          padding: "20px 20px 28px",
          borderLeft: "1px solid var(--bd)",
          background: "var(--bg-s)",
          color: "var(--t2)",
          fontSize: 10.5,
          lineHeight: 1.55,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, color: "var(--t3)", fontSize: 9 }}>
            {index + 1} of {files.length}
          </span>
          <button ref={closeRef} type="button" onClick={onClose} style={{ ...shareButton, minHeight: 32 }}>
            Close
          </button>
        </div>

        <h3 style={{ margin: "14px 0 0", color: "var(--t1)", fontSize: 12, fontWeight: 700, overflowWrap: "anywhere" }}>
          {file.filename}
        </h3>
        {label ? (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8 }}>
            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: "50%", background: LABEL_COLORS[label] }} />
            {DEFAULT_LABEL_NAMES[label]} label
          </div>
        ) : null}

        {details.caption ? (
          <section style={{ marginTop: 20 }}>
            <div style={{ color: "var(--t3)", fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase" }}>
              Caption · {CAPTION_LANG_NAMES[details.caption.lang]} · {CAPTION_STYLE_TITLES[details.caption.style]}
            </div>
            {caption ? (
              <p lang={details.caption.lang} style={{ margin: "6px 0 0", color: "var(--t1)", fontSize: 11.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {caption}
              </p>
            ) : (
              <p style={{ margin: "6px 0 0" }}>No caption for this file.</p>
            )}
          </section>
        ) : null}

        {tags.length ? (
          <section style={{ marginTop: 20 }}>
            <div style={{ color: "var(--t3)", fontSize: 9, letterSpacing: ".07em", textTransform: "uppercase" }}>Tags</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
              {tags.map((tag) => (
                <button key={tag} type="button" title={`Show files tagged “${tag}”`} onClick={() => onTag(tag)} style={{ ...shareChip(false), minHeight: 26 }}>
                  {tag}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <a
          href={shareMediaHref(token, file.id, "original")}
          rel="noreferrer"
          style={{ ...shareButton, width: "100%", boxSizing: "border-box", marginTop: 24 }}
        >
          <span aria-hidden="true">↓</span>
          {file.hasOriginal ? "Download original" : "Download web-size"}
        </a>
      </aside>
    </div>
  );
}
