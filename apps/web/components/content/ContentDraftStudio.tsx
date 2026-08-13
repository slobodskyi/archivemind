"use client";

import { useId, useState } from "react";
import type { ContentDraft } from "@/lib/content-drafts";
import { sourcesChanged } from "@/lib/content-drafts";
import { photoSrc } from "@/lib/img";
import { usedAssetIds } from "@/lib/content-package";
import { useDialog } from "@/hooks/useDialog";
import { Z } from "@/lib/ui";
import type { Photo } from "@/types";

interface ContentDraftStudioProps {
  draft: ContentDraft | null;
  photos: Photo[];
  currentAssetIds: string[];
  saveState: "saved" | "saving" | "error";
  onChange: (draft: ContentDraft) => void;
  onClose: () => void;
  onDelete: () => void;
  onRegenerate: (draft: ContentDraft) => void;
  onDownloadCopy: () => void;
  onDownloadPhotos: (assetIds: string[]) => void;
}

const field = {
  width: "100%",
  boxSizing: "border-box",
  border: 0,
  borderBottom: "1px solid var(--bd)",
  borderRadius: 0,
  background: "transparent",
  color: "var(--t1)",
  outline: "none",
  fontFamily: "inherit",
} as const;

function move<T>(values: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= values.length) return [...values];
  const next = [...values];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function Thumbnail({ assetId, photos }: { assetId: string | null; photos: readonly Photo[] }) {
  const photo = assetId ? photos.find((item) => item.id === assetId) : null;
  if (!photo) return <div style={{ width: "100%", height: "100%", background: "var(--bg-el)" }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={photoSrc(photo, 500, 500)} alt={photo.filename} style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />;
}

export default function ContentDraftStudio({
  draft,
  photos,
  currentAssetIds,
  saveState,
  onChange,
  onClose,
  onDelete,
  onRegenerate,
  onDownloadCopy,
  onDownloadPhotos,
}: ContentDraftStudioProps) {
  const [railOpen, setRailOpen] = useState(true);
  const titleId = useId();
  const dialogRef = useDialog<HTMLDivElement>(draft !== null, onClose);
  if (!draft) return null;

  const changed = sourcesChanged(draft.sourceSnapshot, currentAssetIds);
  const usedIds = usedAssetIds(draft);
  const update = (next: ContentDraft) => onChange(next);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      style={{ position: "fixed", inset: 0, zIndex: Z.modal, display: "flex", flexDirection: "column", background: "var(--bg)" }}
    >
      <header style={{ height: 58, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "0 16px", background: "var(--bg-nb)", borderBottom: "1px solid var(--bd)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--t3)", fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em" }}>{draft.kind === "article" ? "ARTICLE" : "INSTAGRAM CAROUSEL"}</span>
            {changed && <span style={{ padding: "3px 6px", color: "#ffbd66", border: "1px solid rgba(255,184,77,.35)", fontSize: 9.5 }}>Sources changed</span>}
          </div>
          <input
            id={titleId}
            data-autofocus=""
            value={draft.name}
            onChange={(event) => update({ ...draft, name: event.target.value })}
            aria-label="Draft name"
            style={{ width: 330, maxWidth: "42vw", marginTop: 4, padding: 0, border: 0, background: "transparent", color: "var(--t1)", outline: "none", fontFamily: "inherit", fontSize: 13.5, fontWeight: 700 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span role="status" style={{ marginRight: 4, color: saveState === "error" ? "var(--red)" : "var(--t3)", fontSize: 10.5 }}>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved locally"}</span>
          <button onClick={() => setRailOpen((open) => !open)} style={{ height: 32, padding: "0 10px", background: railOpen ? "var(--bg-el)" : "transparent", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontFamily: "inherit", cursor: "pointer" }}>Sources</button>
          <button onClick={() => onRegenerate(draft)} title={draft.hasManualEdits ? "Creates a new version; manual edits are never silently replaced" : undefined} style={{ height: 32, padding: "0 10px", background: "transparent", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontFamily: "inherit", cursor: "pointer" }}>Regenerate</button>
          <button onClick={onDownloadCopy} style={{ height: 32, padding: "0 11px", background: "var(--ac)", border: 0, borderRadius: 2, color: "#050505", fontFamily: "inherit", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>EXPORT COPY</button>
          <button onClick={onClose} aria-label="Close draft studio" style={{ width: 32, height: 32, background: "transparent", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
      </header>

      <div style={{ minHeight: 0, flex: 1, display: "flex" }}>
        <main style={{ minWidth: 0, flex: 1, overflow: "auto", padding: draft.kind === "article" ? "42px clamp(24px,8vw,120px) 100px" : "28px 30px 100px" }}>
          {draft.kind === "article" ? (
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <textarea value={draft.content.title} onChange={(event) => update({ ...draft, content: { ...draft.content, title: event.target.value } })} aria-label="Article title" placeholder="Article title" rows={2} style={{ ...field, padding: "0 0 12px", resize: "none", overflow: "hidden", fontSize: 38, fontWeight: 750, lineHeight: 1.08 }} />
              <textarea value={draft.content.dek} onChange={(event) => update({ ...draft, content: { ...draft.content, dek: event.target.value } })} aria-label="Article standfirst" placeholder="Standfirst" rows={2} style={{ ...field, marginTop: 18, padding: "0 0 12px", resize: "vertical", color: "var(--t2)", fontSize: 18, lineHeight: 1.45 }} />
              <textarea value={draft.content.intro} onChange={(event) => update({ ...draft, content: { ...draft.content, intro: event.target.value } })} aria-label="Article introduction" placeholder="Introduction" rows={5} style={{ ...field, marginTop: 30, padding: "0 0 16px", resize: "vertical", fontSize: 15, lineHeight: 1.75 }} />
              {draft.content.sections.map((section, index) => (
                <section key={section.id} style={{ marginTop: 32 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ color: "var(--t3)", fontSize: 9.5, fontWeight: 800 }}>SECTION {index + 1}</span>
                    <button onClick={() => update({ ...draft, content: { ...draft.content, sections: move(draft.content.sections, index, index - 1) } })} disabled={index === 0} aria-label="Move section up" style={{ marginLeft: "auto", border: 0, background: "transparent", color: "var(--t3)", cursor: index ? "pointer" : "default" }}>↑</button>
                    <button onClick={() => update({ ...draft, content: { ...draft.content, sections: move(draft.content.sections, index, index + 1) } })} disabled={index === draft.content.sections.length - 1} aria-label="Move section down" style={{ border: 0, background: "transparent", color: "var(--t3)", cursor: index < draft.content.sections.length - 1 ? "pointer" : "default" }}>↓</button>
                  </div>
                  <input value={section.heading} onChange={(event) => update({ ...draft, content: { ...draft.content, sections: draft.content.sections.map((item) => item.id === section.id ? { ...item, heading: event.target.value } : item) } })} aria-label={`Section ${index + 1} heading`} placeholder="Section heading" style={{ ...field, padding: "0 0 8px", fontSize: 23, fontWeight: 700 }} />
                  <textarea value={section.body} onChange={(event) => update({ ...draft, content: { ...draft.content, sections: draft.content.sections.map((item) => item.id === section.id ? { ...item, body: event.target.value } : item) } })} aria-label={`Section ${index + 1} body`} rows={7} style={{ ...field, marginTop: 12, padding: "0 0 14px", resize: "vertical", fontSize: 15, lineHeight: 1.75 }} />
                  {section.assetIds.map((assetId) => (
                    <div key={assetId} style={{ marginTop: 18, height: 260, overflow: "hidden", background: "var(--bg-el)", border: "1px solid var(--bd)" }}><Thumbnail assetId={assetId} photos={photos} /></div>
                  ))}
                </section>
              ))}
              <textarea value={draft.content.socialExcerpt} onChange={(event) => update({ ...draft, content: { ...draft.content, socialExcerpt: event.target.value } })} aria-label="Social excerpt" placeholder="Social excerpt" rows={4} style={{ ...field, marginTop: 40, padding: "12px", border: "1px solid var(--bd)", resize: "vertical", color: "var(--t2)", fontSize: 13, lineHeight: 1.55 }} />
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 440px) minmax(280px, 1fr)", gap: 28, maxWidth: 1050, margin: "0 auto" }}>
              <div style={{ alignSelf: "start", position: "sticky", top: 0 }}>
                {draft.content.slides.map((slide, index) => (
                  <div key={slide.id} style={{ display: "grid", gridTemplateColumns: "54px 1fr auto", alignItems: "center", gap: 10, marginBottom: 8, padding: 8, background: "var(--bg-sf)", border: "1px solid var(--bd)" }}>
                    <span style={{ color: "var(--t3)", fontSize: 10, textAlign: "center" }}>{index + 1}</span>
                    <span style={{ minWidth: 0, color: "var(--t2)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{slide.headline || "Untitled slide"}</span>
                    <span>
                      <button onClick={() => update({ ...draft, content: { ...draft.content, slides: move(draft.content.slides, index, index - 1) } })} disabled={index === 0} aria-label="Move slide up" style={{ border: 0, background: "transparent", color: "var(--t3)", cursor: index ? "pointer" : "default" }}>↑</button>
                      <button onClick={() => update({ ...draft, content: { ...draft.content, slides: move(draft.content.slides, index, index + 1) } })} disabled={index === draft.content.slides.length - 1} aria-label="Move slide down" style={{ border: 0, background: "transparent", color: "var(--t3)", cursor: index < draft.content.slides.length - 1 ? "pointer" : "default" }}>↓</button>
                    </span>
                  </div>
                ))}
              </div>
              <div>
                {draft.content.slides.map((slide, index) => (
                  <section key={slide.id} style={{ display: "grid", gridTemplateColumns: "minmax(180px,280px) 1fr", gap: 16, marginBottom: 22, paddingBottom: 22, borderBottom: "1px solid var(--bd)" }}>
                    <div style={{ aspectRatio: draft.settings.aspectRatio === "4:5" ? "4 / 5" : "1 / 1", overflow: "hidden", background: "var(--bg-el)", border: "1px solid var(--bd)" }}><Thumbnail assetId={slide.assetId} photos={photos} /></div>
                    <div>
                      <span style={{ color: "var(--t3)", fontSize: 9.5, fontWeight: 800 }}>SLIDE {index + 1}</span>
                      <textarea value={slide.headline} onChange={(event) => update({ ...draft, content: { ...draft.content, slides: draft.content.slides.map((item) => item.id === slide.id ? { ...item, headline: event.target.value } : item) } })} aria-label={`Slide ${index + 1} headline`} rows={2} style={{ ...field, marginTop: 12, padding: "0 0 8px", resize: "vertical", fontSize: 22, fontWeight: 750, lineHeight: 1.15 }} />
                      <textarea value={slide.body} onChange={(event) => update({ ...draft, content: { ...draft.content, slides: draft.content.slides.map((item) => item.id === slide.id ? { ...item, body: event.target.value } : item) } })} aria-label={`Slide ${index + 1} body`} rows={5} style={{ ...field, marginTop: 12, padding: "0 0 8px", resize: "vertical", fontSize: 13.5, lineHeight: 1.55 }} />
                    </div>
                  </section>
                ))}
                <textarea value={draft.content.caption} onChange={(event) => update({ ...draft, content: { ...draft.content, caption: event.target.value } })} aria-label="Instagram caption" placeholder="Post caption" rows={8} style={{ ...field, padding: 12, border: "1px solid var(--bd)", resize: "vertical", fontSize: 13.5, lineHeight: 1.55 }} />
                <input value={draft.content.hashtags.join(" ")} onChange={(event) => update({ ...draft, content: { ...draft.content, hashtags: event.target.value.split(/\s+/).filter(Boolean) } })} aria-label="Hashtags" placeholder="#archive #story" style={{ ...field, marginTop: 10, padding: "10px 0", color: "var(--ac)", fontSize: 12.5 }} />
              </div>
            </div>
          )}
        </main>

        {railOpen && (
          <aside style={{ width: 214, flex: "0 0 auto", overflow: "auto", padding: 10, background: "var(--bg-nb)", borderLeft: "1px solid var(--bd)" }}>
            <div style={{ padding: "4px 4px 10px", color: "var(--t3)", fontSize: 9.5, fontWeight: 800, letterSpacing: ".08em" }}>SOURCE SNAPSHOT · {draft.sourceSnapshot.assetIds.length}</div>
            {draft.sourceSnapshot.assetIds.map((assetId, index) => {
              const photo = photos.find((item) => item.id === assetId);
              return (
                <div key={assetId} style={{ display: "grid", gridTemplateColumns: "22px 54px 1fr", alignItems: "center", gap: 7, marginBottom: 7 }}>
                  <span style={{ color: "var(--t3)", fontSize: 9.5, textAlign: "right" }}>{index + 1}</span>
                  <div style={{ width: 54, height: 42, overflow: "hidden", background: "var(--bg-el)" }}><Thumbnail assetId={assetId} photos={photos} /></div>
                  <span title={photo?.filename ?? assetId} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t2)", fontSize: 10.5 }}>{photo?.filename ?? assetId}</span>
                </div>
              );
            })}
          </aside>
        )}
      </div>

      <footer style={{ height: 50, flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8, padding: "0 16px", background: "var(--bg-nb)", borderTop: "1px solid var(--bd)" }}>
        <button onClick={onDelete} style={{ height: 30, padding: "0 10px", background: "transparent", border: 0, color: "var(--red)", fontFamily: "inherit", cursor: "pointer" }}>Delete draft</button>
        <span style={{ marginLeft: "auto", color: "var(--t3)", fontSize: 10.5 }}>Copy and source files are separate downloads in this MVP</span>
        <button onClick={() => onDownloadPhotos(usedIds.length ? usedIds : draft.sourceSnapshot.assetIds)} style={{ height: 32, padding: "0 11px", background: "transparent", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontFamily: "inherit", cursor: "pointer" }}>DOWNLOAD PHOTOS {usedIds.length || draft.sourceSnapshot.assetIds.length}</button>
      </footer>
    </div>
  );
}
