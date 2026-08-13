"use client";

import {
  forwardRef,
  useId,
  useImperativeHandle,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import {
  createDefaultArticleMedia,
  sourcesChanged,
  type ArticleContentDraft,
  type ArticleDraftMedia,
  type ContentDraft,
  type InstagramCarouselContentDraft,
} from "@/lib/content-drafts";
import {
  applyMarkdownCommand,
  moveArticlePlacement,
  removeArticlePlacement,
  reorderArticlePlacement,
  type MarkdownCommand,
} from "@/lib/content-editor";
import { isRealSource, photoSrc, photoSrcMedium } from "@/lib/img";
import { usedAssetIds } from "@/lib/content-package";
import { useDialog } from "@/hooks/useDialog";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";
import type { Photo } from "@/types";
import ConfirmModal from "@/components/modals/ConfirmModal";

interface ContentDraftStudioProps {
  draft: ContentDraft | null;
  /** A nested confirmation owns focus while the editor stays mounted behind it. */
  suspended?: boolean;
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

interface AutoGrowTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  minHeight?: number;
}

const chromeButton: CSSProperties = {
  height: 32,
  padding: "0 10px",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "transparent",
  color: "var(--t2)",
  fontFamily: "inherit",
  fontSize: 11,
  cursor: "pointer",
};

const documentField: CSSProperties = {
  width: "100%",
  display: "block",
  padding: 0,
  border: 0,
  borderRadius: 0,
  background: "transparent",
  color: "var(--t1)",
  outline: "none",
  fontFamily: '"Inter Tight Variable", system-ui, sans-serif',
};

const panelLabel: CSSProperties = {
  display: "block",
  marginBottom: 7,
  color: "var(--t3)",
  fontSize: 9.5,
  fontWeight: 800,
  letterSpacing: ".08em",
  textTransform: "uppercase",
};

const AutoGrowTextarea = forwardRef(function AutoGrowTextarea(
  { minHeight = 28, style, value, onInput, ...props }: AutoGrowTextareaProps,
  forwardedRef: Ref<HTMLTextAreaElement>,
) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement);

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    let measuredWidth = node.getBoundingClientRect().width;
    const resize = () => {
      node.style.height = "0px";
      node.style.height = `${Math.max(minHeight, node.scrollHeight)}px`;
    };
    resize();
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? measuredWidth;
      if (width === measuredWidth) return;
      measuredWidth = width;
      resize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [minHeight, value]);

  return (
    <textarea
      {...props}
      ref={innerRef}
      value={value}
      rows={1}
      onInput={(event) => {
        const node = event.currentTarget;
        node.style.height = "0px";
        node.style.height = `${Math.max(minHeight, node.scrollHeight)}px`;
        onInput?.(event);
      }}
      style={{ ...style, minHeight, height: minHeight, overflow: "hidden", resize: "none" }}
    />
  );
});

function move<T>(values: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= values.length) return [...values];
  const next = [...values];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function SmallThumbnail({ assetId, photos }: { assetId: string | null; photos: readonly Photo[] }) {
  const photo = assetId ? photos.find((item) => item.id === assetId) : null;
  if (!photo) return <div style={{ width: "100%", height: "100%", background: "var(--bg-el)" }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={photoSrc(photo, 180, 140)} alt="" style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }} />;
}

function useMediumPreview(photo: Photo | null): string | undefined {
  const [medium, setMedium] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (!photo || !isRealSource(photo.source) || photo.srcMedium) return;
    const id = photo.id;
    let alive = true;
    fetch(`/api/assets/${id}/medium`)
      .then((response) => response.ok ? (response.json() as Promise<{ url: string | null }>) : null)
      .then((payload) => {
        if (alive && payload?.url) setMedium({ id, url: payload.url });
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [photo]);
  return photo && medium?.id === photo.id ? medium.url : undefined;
}

function LargePreview({
  assetId,
  photos,
  alt,
  fit = "cover",
  focalPoint = { x: 0.5, y: 0.5 },
}: {
  assetId: string | null;
  photos: readonly Photo[];
  alt: string;
  fit?: "cover" | "contain";
  focalPoint?: { x: number; y: number };
}) {
  const photo = assetId ? photos.find((item) => item.id === assetId) : null;
  const medium = useMediumPreview(photo ?? null);
  if (!photo) return <div style={{ width: "100%", height: "100%", background: "var(--bg-el)" }} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={medium ?? photoSrcMedium(photo, 1000, 1250)}
      alt={alt}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        objectFit: fit,
        objectPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%`,
      }}
    />
  );
}

function segmentedStyle(active: boolean, disabled = false): CSSProperties {
  return {
    minWidth: 0,
    height: 29,
    flex: 1,
    padding: "0 5px",
    border: `1px solid ${active ? "var(--bdh)" : "var(--bd)"}`,
    borderRadius: 2,
    background: active ? "var(--bg-el)" : "transparent",
    color: active ? "var(--t1)" : "var(--t3)",
    fontFamily: "inherit",
    fontSize: 9.5,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.35 : 1,
  };
}

function ArticleImage({
  media,
  photos,
  selected,
  onSelect,
}: {
  media: ArticleDraftMedia;
  photos: readonly Photo[];
  selected: boolean;
  onSelect: () => void;
}) {
  const photo = photos.find((item) => item.id === media.assetId);
  const medium = useMediumPreview(photo ?? null);
  const { presentation } = media;
  const width = presentation.width === "small"
    ? "46%"
    : presentation.width === "medium"
      ? "68%"
      : presentation.width === "wide"
        ? "100%"
        : "min(calc(100% + 180px), calc(100vw - 96px - var(--draft-rail, 0px)))";
  const marginLeft = presentation.alignment === "right"
    ? "auto"
    : presentation.alignment === "center" || presentation.width === "full"
      ? "50%"
      : 0;
  const translate = presentation.alignment === "center" || presentation.width === "full" ? "translateX(-50%)" : undefined;
  const aspectRatio = presentation.aspect === "landscape"
    ? "16 / 9"
    : presentation.aspect === "portrait"
      ? "4 / 5"
      : presentation.aspect === "square"
        ? "1 / 1"
        : photo
          ? `${photo.w} / ${photo.h}`
          : "16 / 9";

  return (
    <figure className="content-draft-figure" style={{ width, maxWidth: "var(--draft-full-max, calc(100vw - 96px))", margin: "26px 0 4px", marginLeft, transform: translate }}>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Edit image ${photo?.filename ?? media.assetId}`}
        style={{
          width: "100%",
          display: "block",
          padding: 0,
          overflow: "hidden",
          aspectRatio,
          border: `1px solid ${selected ? "var(--ac)" : "var(--bd)"}`,
          borderRadius: 2,
          background: "var(--bg-el)",
          boxShadow: selected ? "0 0 0 1px rgba(57,255,106,.18)" : "none",
          cursor: "pointer",
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={medium ?? photoSrcMedium(photo, 1400, 1050)}
            alt={media.altText || photo.filename}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              objectFit: presentation.aspect === "original" ? "contain" : presentation.fit,
              objectPosition: `${presentation.focalPoint.x * 100}% ${presentation.focalPoint.y * 100}%`,
              background: "var(--bg-el)",
            }}
          />
        ) : <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--t3)", fontSize: 11 }}>Source unavailable</div>}
      </button>
      {media.caption ? <figcaption style={{ marginTop: 8, color: "var(--t3)", fontSize: 12, lineHeight: 1.45 }}>{media.caption}</figcaption> : null}
    </figure>
  );
}

function FormattingToolbar({
  textarea,
  onChange,
  onAddSection,
}: {
  textarea: HTMLTextAreaElement | null;
  onChange: (value: string) => void;
  onAddSection: () => void;
}) {
  const apply = (command: MarkdownCommand) => {
    if (!textarea) return;
    const edit = applyMarkdownCommand(textarea.value, textarea.selectionStart, textarea.selectionEnd, command);
    onChange(edit.value);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };
  const buttons: readonly [MarkdownCommand, string, string][] = [
    ["bold", "B", "Bold (⌘B)"],
    ["italic", "I", "Italic (⌘I)"],
    ["link", "↗", "Link (⌘K)"],
    ["heading3", "H3", "Subheading"],
    ["bullet", "•", "Bulleted list"],
    ["numbered", "1.", "Numbered list"],
    ["quote", "“", "Quote"],
  ];

  return (
    <div role="toolbar" aria-label="Text formatting" style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {buttons.map(([command, label, title]) => (
        <button
          key={command}
          type="button"
          title={title}
          aria-label={title}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => apply(command)}
          disabled={!textarea}
          className="am-tb"
          style={{ ...segmentedStyle(false, !textarea), width: 30, flex: "0 0 30px", fontWeight: command === "bold" ? 800 : 500, fontStyle: command === "italic" ? "italic" : "normal" }}
        >
          {label}
        </button>
      ))}
      <span style={{ width: 1, height: 18, margin: "0 4px", background: "var(--bd)" }} />
      <button type="button" onClick={onAddSection} style={{ ...chromeButton, height: 29 }}>+ Section</button>
    </div>
  );
}

function ArticleEditor({
  draft,
  photos,
  onChange,
  railOpen,
  selectedMedia,
  onSelectMedia,
  onActivateBody,
  onDeactivateBody,
  onRequestRemoveSection,
}: {
  draft: ArticleContentDraft;
  photos: readonly Photo[];
  onChange: (draft: ArticleContentDraft) => void;
  railOpen: boolean;
  selectedMedia: { sectionId: string; assetId: string } | null;
  onSelectMedia: (placement: { sectionId: string; assetId: string } | null) => void;
  onActivateBody: (sectionId: string, node: HTMLTextAreaElement) => void;
  onDeactivateBody: () => void;
  onRequestRemoveSection: (sectionId: string) => void;
}) {
  const updateSection = (sectionId: string, patch: Partial<ArticleContentDraft["content"]["sections"][number]>) => {
    onChange({
      ...draft,
      content: {
        ...draft.content,
        sections: draft.content.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section),
      },
    });
  };
  const bodyShortcut = (event: KeyboardEvent<HTMLTextAreaElement>, sectionId: string) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const command = event.key.toLowerCase() === "b" ? "bold" : event.key.toLowerCase() === "i" ? "italic" : event.key.toLowerCase() === "k" ? "link" : null;
    if (!command) return;
    event.preventDefault();
    const node = event.currentTarget;
    const edit = applyMarkdownCommand(node.value, node.selectionStart, node.selectionEnd, command);
    updateSection(sectionId, { body: edit.value });
    requestAnimationFrame(() => {
      node.focus();
      node.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };

  return (
    <article
      onClick={(event) => {
        if (event.currentTarget === event.target) {
          onSelectMedia(null);
          onDeactivateBody();
        }
      }}
      style={{
        "--draft-rail": railOpen ? "248px" : "0px",
        width: "min(100%, 720px)",
        margin: "0 auto",
        padding: `54px ${railOpen ? "48px" : "64px"} 100px`,
        fontFamily: '"Inter Tight Variable", system-ui, sans-serif',
      } as CSSProperties}
      className="content-draft-document"
    >
      <AutoGrowTextarea value={draft.content.title} maxLength={300} onFocus={onDeactivateBody} onChange={(event) => onChange({ ...draft, content: { ...draft.content, title: event.target.value } })} aria-label="Article title" placeholder="Article title" minHeight={54} style={{ ...documentField, fontSize: 42, fontWeight: 760, lineHeight: 1.08, letterSpacing: "-.025em" }} />
      <AutoGrowTextarea value={draft.content.dek} maxLength={1_000} onFocus={onDeactivateBody} onChange={(event) => onChange({ ...draft, content: { ...draft.content, dek: event.target.value } })} aria-label="Article standfirst" placeholder="Standfirst — a concise reason to keep reading" minHeight={44} style={{ ...documentField, marginTop: 20, color: "var(--t2)", fontSize: 20, lineHeight: 1.42 }} />
      <div style={{ width: 48, height: 1, margin: "32px 0", background: "var(--bdh)" }} />
      <AutoGrowTextarea value={draft.content.intro} maxLength={50_000} onFocus={onDeactivateBody} onChange={(event) => onChange({ ...draft, content: { ...draft.content, intro: event.target.value } })} aria-label="Article introduction" placeholder="Introduction" minHeight={100} style={{ ...documentField, fontSize: 17, lineHeight: 1.68 }} />

      {draft.content.sections.map((section, index) => (
        <section key={section.id} style={{ marginTop: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 14 }}>
            <span style={{ color: "var(--t3)", fontFamily: "var(--font-space-mono), monospace", fontSize: 9.5, fontWeight: 800, letterSpacing: ".07em" }}>SECTION {index + 1}</span>
            <button type="button" className="am-tb" onClick={() => onChange({ ...draft, content: { ...draft.content, sections: move(draft.content.sections, index, index - 1) } })} disabled={index === 0} aria-label="Move section up" style={{ ...segmentedStyle(false, index === 0), width: 27, flex: "0 0 27px", marginLeft: "auto" }}>↑</button>
            <button type="button" className="am-tb" onClick={() => onChange({ ...draft, content: { ...draft.content, sections: move(draft.content.sections, index, index + 1) } })} disabled={index === draft.content.sections.length - 1} aria-label="Move section down" style={{ ...segmentedStyle(false, index === draft.content.sections.length - 1), width: 27, flex: "0 0 27px" }}>↓</button>
            <button
              type="button"
              className="am-tb"
              onClick={() => onRequestRemoveSection(section.id)}
              aria-label={`Remove section ${index + 1}`}
              title="Remove section"
              style={{ ...segmentedStyle(false), width: 27, flex: "0 0 27px", color: "var(--red)" }}
            >×</button>
          </div>
          <AutoGrowTextarea data-section-heading={section.id} value={section.heading} maxLength={300} onFocus={onDeactivateBody} onChange={(event) => updateSection(section.id, { heading: event.target.value })} aria-label={`Section ${index + 1} heading`} placeholder="Section heading" minHeight={38} style={{ ...documentField, fontSize: 29, fontWeight: 740, lineHeight: 1.2, letterSpacing: "-.015em" }} />
          <AutoGrowTextarea
            value={section.body}
            maxLength={50_000}
            onFocus={(event) => onActivateBody(section.id, event.currentTarget)}
            onKeyDown={(event) => bodyShortcut(event, section.id)}
            onChange={(event) => updateSection(section.id, { body: event.target.value })}
            aria-label={`Section ${index + 1} body`}
            placeholder="Write this section…"
            minHeight={80}
            style={{ ...documentField, marginTop: 18, fontSize: 17, lineHeight: 1.68 }}
          />
          {section.media.map((media) => (
            <ArticleImage
              key={media.assetId}
              media={media}
              photos={photos}
              selected={selectedMedia?.sectionId === section.id && selectedMedia.assetId === media.assetId}
              onSelect={() => {
                onDeactivateBody();
                onSelectMedia({ sectionId: section.id, assetId: media.assetId });
              }}
            />
          ))}
        </section>
      ))}

      <div style={{ marginTop: 60, padding: "18px 20px", border: "1px solid var(--bd)", borderRadius: 2, background: "var(--bg-in)" }}>
        <span style={{ ...panelLabel, marginBottom: 10 }}>Social excerpt</span>
        <AutoGrowTextarea value={draft.content.socialExcerpt} maxLength={2_200} onFocus={onDeactivateBody} onChange={(event) => onChange({ ...draft, content: { ...draft.content, socialExcerpt: event.target.value } })} aria-label="Social excerpt" placeholder="A short version for sharing" minHeight={62} style={{ ...documentField, color: "var(--t2)", fontSize: 14, lineHeight: 1.55 }} />
      </div>
    </article>
  );
}

function ImageSettings({
  draft,
  sectionId,
  assetId,
  photos,
  onChange,
  onDone,
}: {
  draft: ArticleContentDraft;
  sectionId: string;
  assetId: string;
  photos: readonly Photo[];
  onChange: (draft: ArticleContentDraft) => void;
  onDone: () => void;
}) {
  const sectionIndex = draft.content.sections.findIndex((section) => section.id === sectionId);
  const section = draft.content.sections[sectionIndex];
  const media = section?.media.find((item) => item.assetId === assetId) ?? createDefaultArticleMedia(assetId);
  const photo = photos.find((item) => item.id === assetId);
  if (!section) return null;

  const updateMedia = (nextMedia: ArticleDraftMedia) => {
    const nextSections = draft.content.sections.map((item) => item.id === section.id
      ? { ...item, media: item.media.map((entry) => entry.assetId === assetId ? nextMedia : entry) }
      : item);
    onChange({ ...draft, content: { ...draft.content, sections: nextSections } });
  };
  const updatePresentation = (patch: Partial<ArticleDraftMedia["presentation"]>) => updateMedia({
    ...media,
    presentation: { ...media.presentation, ...patch },
  });
  const positions = [0, 0.5, 1];
  const alignmentDisabled = media.presentation.width === "wide" || media.presentation.width === "full";
  const mediaIndex = section.media.findIndex((item) => item.assetId === assetId);
  const previousSection = sectionIndex > 0 ? draft.content.sections[sectionIndex - 1] : null;
  const nextSection = sectionIndex < draft.content.sections.length - 1 ? draft.content.sections[sectionIndex + 1] : null;
  const canMoveToPrevious = Boolean(previousSection && !previousSection.assetIds.includes(assetId));
  const canMoveToNext = Boolean(nextSection && !nextSection.assetIds.includes(assetId));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button type="button" onClick={onDone} aria-label="Back to sources" style={{ ...segmentedStyle(false), width: 29, flex: "0 0 29px" }}>←</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--t1)", fontSize: 11.5, fontWeight: 700 }}>Image settings</div>
          <div title={photo?.filename} style={{ marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t3)", fontSize: 9.5 }}>{photo?.filename ?? assetId}</div>
        </div>
      </div>

      <div style={{ marginBottom: 16, overflow: "hidden", aspectRatio: photo ? `${photo.w} / ${photo.h}` : "4 / 3", background: "var(--bg-el)", border: "1px solid var(--bd)" }}>
        <LargePreview assetId={assetId} photos={photos} alt="" />
      </div>

      <span style={panelLabel}>Width</span>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["small", "medium", "wide", "full"] as const).map((value) => <button key={value} className="am-tb" aria-pressed={media.presentation.width === value} onClick={() => updatePresentation({ width: value })} style={segmentedStyle(media.presentation.width === value)}>{value === "small" ? "S" : value === "medium" ? "M" : value === "wide" ? "W" : "Full"}</button>)}
      </div>

      <span style={panelLabel}>Alignment</span>
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["left", "center", "right"] as const).map((value) => <button key={value} className="am-tb" aria-pressed={media.presentation.alignment === value} disabled={alignmentDisabled} onClick={() => updatePresentation({ alignment: value })} style={segmentedStyle(media.presentation.alignment === value, alignmentDisabled)}>{value === "left" ? "←" : value === "center" ? "↔" : "→"}</button>)}
      </div>

      <span style={panelLabel}>Frame</span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 12 }}>
        {(["original", "landscape", "portrait", "square"] as const).map((value) => <button key={value} className="am-tb" aria-pressed={media.presentation.aspect === value} onClick={() => updatePresentation({ aspect: value })} style={segmentedStyle(media.presentation.aspect === value)}>{value === "original" ? "Original" : value === "landscape" ? "16:9" : value === "portrait" ? "4:5" : "1:1"}</button>)}
      </div>
      {media.presentation.aspect !== "original" ? (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
            {(["cover", "contain"] as const).map((value) => <button key={value} className="am-tb" aria-pressed={media.presentation.fit === value} onClick={() => updatePresentation({ fit: value })} style={segmentedStyle(media.presentation.fit === value)}>{value === "cover" ? "Crop" : "Fit"}</button>)}
          </div>
          {media.presentation.fit === "cover" ? (
            <>
              <span style={panelLabel}>Focal point</span>
              <div role="group" aria-label="Image focal point" style={{ width: 140, maxWidth: "100%", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3, marginBottom: 16 }}>
                {positions.flatMap((y) => positions.map((x) => {
                  const active = media.presentation.focalPoint.x === x && media.presentation.focalPoint.y === y;
                  return <button key={`${x}-${y}`} className="am-tb" aria-label={`Focal point ${x * 100}% ${y * 100}%`} aria-pressed={active} onClick={() => updatePresentation({ focalPoint: { x, y } })} style={{ width: 27, height: 24, border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`, borderRadius: 2, background: active ? "rgba(57,255,106,.1)" : "transparent", cursor: "pointer" }} />;
                }))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      <label style={{ ...panelLabel, marginBottom: 12 }}>Caption
        <AutoGrowTextarea value={media.caption} maxLength={2_000} onChange={(event) => updateMedia({ ...media, caption: event.target.value })} minHeight={54} placeholder="Optional visible caption" style={{ width: "100%", marginTop: 7, padding: 8, border: "1px solid var(--bd)", borderRadius: 2, background: "var(--bg)", color: "var(--t2)", fontFamily: "inherit", fontSize: 10.5, lineHeight: 1.45, outline: "none", textTransform: "none", letterSpacing: 0 }} />
      </label>
      <label style={{ ...panelLabel, marginBottom: 14 }}>Alt text
        <AutoGrowTextarea value={media.altText} maxLength={1_000} onChange={(event) => updateMedia({ ...media, altText: event.target.value })} minHeight={54} placeholder="Describe the image" style={{ width: "100%", marginTop: 7, padding: 8, border: "1px solid var(--bd)", borderRadius: 2, background: "var(--bg)", color: "var(--t2)", fontFamily: "inherit", fontSize: 10.5, lineHeight: 1.45, outline: "none", textTransform: "none", letterSpacing: 0 }} />
      </label>

      <span style={panelLabel}>Position</span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
        <button disabled={mediaIndex === 0} onClick={() => {
          if (mediaIndex === 0) return;
          onChange({ ...draft, content: { ...draft.content, sections: reorderArticlePlacement(draft.content.sections, section.id, assetId, mediaIndex - 1) } });
        }} style={segmentedStyle(false, mediaIndex === 0)}>← Earlier</button>
        <button disabled={mediaIndex === section.media.length - 1} onClick={() => {
          if (mediaIndex === section.media.length - 1) return;
          onChange({ ...draft, content: { ...draft.content, sections: reorderArticlePlacement(draft.content.sections, section.id, assetId, mediaIndex + 1) } });
        }} style={segmentedStyle(false, mediaIndex === section.media.length - 1)}>Later →</button>
        <button disabled={!canMoveToPrevious} title={!canMoveToPrevious && previousSection ? "That section already contains this image" : undefined} onClick={() => {
          if (!canMoveToPrevious || !previousSection) return;
          onChange({ ...draft, content: { ...draft.content, sections: moveArticlePlacement(draft.content.sections, section.id, previousSection.id, assetId, previousSection.assetIds.length) } });
          onDone();
        }} style={segmentedStyle(false, !canMoveToPrevious)}>↑ Section</button>
        <button disabled={!canMoveToNext} title={!canMoveToNext && nextSection ? "That section already contains this image" : undefined} onClick={() => {
          if (!canMoveToNext || !nextSection) return;
          onChange({ ...draft, content: { ...draft.content, sections: moveArticlePlacement(draft.content.sections, section.id, nextSection.id, assetId, 0) } });
          onDone();
        }} style={segmentedStyle(false, !canMoveToNext)}>↓ Section</button>
      </div>
      <button onClick={() => {
        onChange({ ...draft, content: { ...draft.content, sections: removeArticlePlacement(draft.content.sections, section.id, assetId) } });
        onDone();
      }} style={{ ...chromeButton, width: "100%", marginTop: 7, borderColor: "rgba(255,68,68,.25)", color: "var(--red)" }}>Remove from article</button>
    </div>
  );
}

function SourcesRail({
  draft,
  photos,
  onAddToArticle,
}: {
  draft: ContentDraft;
  photos: readonly Photo[];
  onAddToArticle?: (assetId: string) => void;
}) {
  const placed = new Set(draft.kind === "article" ? draft.content.sections.flatMap((section) => section.assetIds) : []);
  return (
    <div>
      <div style={{ ...panelLabel, marginBottom: 12 }}>Source snapshot · {draft.sourceSnapshot.assetIds.length}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {draft.sourceSnapshot.assetIds.map((assetId, index) => {
          const photo = photos.find((item) => item.id === assetId);
          return (
            <div key={assetId} style={{ display: "grid", gridTemplateColumns: "20px 50px minmax(0,1fr) auto", alignItems: "center", gap: 7 }}>
              <span style={{ color: "var(--t3)", fontSize: 9, textAlign: "right" }}>{index + 1}</span>
              <div style={{ width: 50, height: 40, overflow: "hidden", background: "var(--bg-el)" }}><SmallThumbnail assetId={assetId} photos={photos} /></div>
              <span title={photo?.filename ?? assetId} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t2)", fontSize: 10 }}>{photo?.filename ?? assetId}</span>
              {draft.kind === "article" ? (
                <button
                  type="button"
                  className="am-tb"
                  disabled={placed.has(assetId) || draft.content.sections.length === 0}
                  title={placed.has(assetId) ? "Already in the article" : draft.content.sections.length === 0 ? "Add a section first" : "Add to the last section"}
                  aria-label={placed.has(assetId) ? `${photo?.filename ?? assetId} is already in the article` : `Add ${photo?.filename ?? assetId} to article`}
                  onClick={() => onAddToArticle?.(assetId)}
                  style={{ ...segmentedStyle(placed.has(assetId), placed.has(assetId) || draft.content.sections.length === 0), width: 28, flex: "0 0 28px" }}
                >{placed.has(assetId) ? "✓" : "+"}</button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CarouselEditor({ draft, photos, onChange }: { draft: InstagramCarouselContentDraft; photos: readonly Photo[]; onChange: (draft: InstagramCarouselContentDraft) => void }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeSlide = draft.content.slides[Math.min(activeIndex, Math.max(0, draft.content.slides.length - 1))];
  const updateSlide = (patch: Partial<InstagramCarouselContentDraft["content"]["slides"][number]>) => {
    if (!activeSlide) return;
    onChange({ ...draft, content: { ...draft.content, slides: draft.content.slides.map((slide) => slide.id === activeSlide.id ? { ...slide, ...patch } : slide) } });
  };
  const positions = [0, 0.5, 1];

  return (
    <div className="content-draft-carousel" style={{ minHeight: "100%", display: "grid", gridTemplateColumns: "170px minmax(280px, 430px) minmax(260px, 1fr)", gap: 26, padding: 30 }}>
      <div className="content-draft-slide-strip" style={{ minWidth: 0 }}>
        <span style={panelLabel}>Slides</span>
        {draft.content.slides.map((slide, index) => (
          <button key={slide.id} aria-current={index === activeIndex ? "true" : undefined} onClick={() => setActiveIndex(index)} style={{ width: "100%", display: "grid", gridTemplateColumns: "36px 1fr auto", alignItems: "center", gap: 8, marginBottom: 6, padding: 7, border: `1px solid ${index === activeIndex ? "var(--ac)" : "var(--bd)"}`, borderRadius: 2, background: index === activeIndex ? "rgba(57,255,106,.06)" : "var(--bg-sf)", color: "inherit", fontFamily: "inherit", textAlign: "left", cursor: "pointer" }}>
            <div style={{ width: 36, height: 36, overflow: "hidden", background: "var(--bg-el)" }}><SmallThumbnail assetId={slide.assetId} photos={photos} /></div>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t2)", fontSize: 9.5 }}>{slide.headline || `Slide ${index + 1}`}</span>
            <span style={{ color: "var(--t3)", fontSize: 9 }}>{index + 1}</span>
          </button>
        ))}
      </div>
      <div style={{ alignSelf: "start", position: "sticky", top: 0 }}>
        <div style={{ overflow: "hidden", aspectRatio: draft.settings.aspectRatio === "4:5" ? "4 / 5" : "1 / 1", border: "1px solid var(--bdh)", borderRadius: 2, background: "var(--bg-el)", boxShadow: "0 20px 60px rgba(0,0,0,.35)" }}>
          <LargePreview
            assetId={activeSlide?.assetId ?? null}
            photos={photos}
            alt={activeSlide?.headline || "Carousel slide preview"}
            fit={activeSlide?.presentation.fit}
            focalPoint={activeSlide?.presentation.focalPoint}
          />
        </div>
      </div>
      <div style={{ maxWidth: 480 }}>
        <span style={panelLabel}>Slide {activeIndex + 1}</span>
        {activeSlide ? (
          <>
            <AutoGrowTextarea value={activeSlide.headline} maxLength={300} onChange={(event) => updateSlide({ headline: event.target.value })} aria-label={`Slide ${activeIndex + 1} headline`} minHeight={52} style={{ ...documentField, fontSize: 28, fontWeight: 750, lineHeight: 1.16 }} />
            <AutoGrowTextarea value={activeSlide.body} maxLength={2_200} onChange={(event) => updateSlide({ body: event.target.value })} aria-label={`Slide ${activeIndex + 1} body`} minHeight={100} style={{ ...documentField, marginTop: 18, fontSize: 16, lineHeight: 1.6 }} />
            {activeSlide.assetId ? (
              <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--bd)" }}>
                <span style={panelLabel}>Image crop</span>
                <div style={{ display: "flex", gap: 5, maxWidth: 220 }}>
                  {(["cover", "contain"] as const).map((fit) => (
                    <button
                      key={fit}
                      type="button"
                      className="am-tb"
                      aria-pressed={activeSlide.presentation.fit === fit}
                      onClick={() => updateSlide({ presentation: { ...activeSlide.presentation, fit } })}
                      style={segmentedStyle(activeSlide.presentation.fit === fit)}
                    >{fit === "cover" ? "Crop" : "Fit"}</button>
                  ))}
                </div>
                {activeSlide.presentation.fit === "cover" ? (
                  <>
                    <span style={{ ...panelLabel, marginTop: 14 }}>Focal point</span>
                    <div role="group" aria-label="Slide image focal point" style={{ width: 140, maxWidth: "100%", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 3 }}>
                      {positions.flatMap((y) => positions.map((x) => {
                        const active = activeSlide.presentation.focalPoint.x === x && activeSlide.presentation.focalPoint.y === y;
                        return (
                          <button
                            key={`${x}-${y}`}
                            type="button"
                            className="am-tb"
                            aria-label={`Focal point ${x * 100}% ${y * 100}%`}
                            aria-pressed={active}
                            onClick={() => updateSlide({ presentation: { ...activeSlide.presentation, focalPoint: { x, y } } })}
                            style={{ width: 27, height: 24, border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`, borderRadius: 2, background: active ? "rgba(57,255,106,.1)" : "transparent", cursor: "pointer" }}
                          />
                        );
                      }))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 5, marginTop: 18 }}>
              <button disabled={activeIndex === 0} onClick={() => { onChange({ ...draft, content: { ...draft.content, slides: move(draft.content.slides, activeIndex, activeIndex - 1) } }); setActiveIndex(Math.max(0, activeIndex - 1)); }} style={segmentedStyle(false, activeIndex === 0)}>Move left</button>
              <button disabled={activeIndex === draft.content.slides.length - 1} onClick={() => { onChange({ ...draft, content: { ...draft.content, slides: move(draft.content.slides, activeIndex, activeIndex + 1) } }); setActiveIndex(Math.min(draft.content.slides.length - 1, activeIndex + 1)); }} style={segmentedStyle(false, activeIndex === draft.content.slides.length - 1)}>Move right</button>
            </div>
          </>
        ) : null}
        <div style={{ marginTop: 34, paddingTop: 22, borderTop: "1px solid var(--bd)" }}>
          <span style={panelLabel}>Post caption</span>
          <AutoGrowTextarea value={draft.content.caption} maxLength={10_000} onChange={(event) => onChange({ ...draft, content: { ...draft.content, caption: event.target.value } })} aria-label="Instagram caption" minHeight={120} style={{ ...documentField, fontSize: 14, lineHeight: 1.55 }} />
          <input value={draft.content.hashtags.join(" ")} maxLength={3_029} onChange={(event) => onChange({ ...draft, content: { ...draft.content, hashtags: event.target.value.split(/\s+/).filter(Boolean).slice(0, 30).map((tag) => tag.slice(0, 100)) } })} aria-label="Hashtags" placeholder="#archive #story" style={{ width: "100%", marginTop: 16, padding: "9px 0", border: 0, borderBottom: "1px solid var(--bd)", background: "transparent", color: "var(--ac)", outline: "none", fontFamily: "inherit", fontSize: 11.5 }} />
        </div>
      </div>
    </div>
  );
}

export default function ContentDraftStudio({
  draft,
  suspended = false,
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
  // Sources are supporting context, not the writing task itself. Start with a
  // quiet document; the rail opens deliberately or contextually on image click.
  const [railOpen, setRailOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ sectionId: string; assetId: string } | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activeTextarea, setActiveTextarea] = useState<HTMLTextAreaElement | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<string | null>(null);
  const titleId = useId();
  const sourcesId = useId();
  const editorSuspended = suspended || sectionToDelete !== null;
  const dialogRef = useDialog<HTMLDivElement>(draft !== null && !editorSuspended, onClose);
  const usedIds = useMemo(() => draft ? usedAssetIds(draft) : [], [draft]);
  if (!draft) return null;

  const changed = sourcesChanged(draft.sourceSnapshot, currentAssetIds);
  const toolbarTextarea =
    draft.kind === "article" && activeSectionId && draft.content.sections.some((section) => section.id === activeSectionId)
      ? activeTextarea
      : null;
  const addSection = () => {
    if (draft.kind !== "article") return;
    const id = typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `section-${Date.now()}`;
    onChange({ ...draft, content: { ...draft.content, sections: [...draft.content.sections, { id, heading: "", body: "", assetIds: [], media: [] }] } });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLTextAreaElement>(`[data-section-heading="${id}"]`);
      heading?.scrollIntoView({ block: "center", behavior: "smooth" });
      heading?.focus();
    }));
  };
  const addSourceToArticle = (assetId: string) => {
    if (draft.kind !== "article" || draft.content.sections.some((section) => section.assetIds.includes(assetId))) return;
    const target = draft.content.sections[draft.content.sections.length - 1];
    if (!target) return;
    onChange({
      ...draft,
      content: {
        ...draft.content,
        sections: draft.content.sections.map((section) => section.id === target.id
          ? { ...section, assetIds: [...section.assetIds, assetId], media: [...section.media, createDefaultArticleMedia(assetId)] }
          : section),
      },
    });
    setSelectedMedia({ sectionId: target.id, assetId });
  };
  const confirmSectionDelete = () => {
    if (draft.kind !== "article" || !sectionToDelete) return;
    if (selectedMedia?.sectionId === sectionToDelete) setSelectedMedia(null);
    if (activeSectionId === sectionToDelete) {
      setActiveSectionId(null);
      setActiveTextarea(null);
    }
    onChange({
      ...draft,
      content: {
        ...draft.content,
        sections: draft.content.sections.filter((section) => section.id !== sectionToDelete),
      },
    });
    setSectionToDelete(null);
  };
  const deleteSection = draft.kind === "article"
    ? draft.content.sections.find((section) => section.id === sectionToDelete) ?? null
    : null;

  return (
    <>
      <div
        className="content-draft-backdrop"
        aria-hidden={editorSuspended || undefined}
        inert={editorSuspended || undefined}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: Z.modal, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: MODAL_BACKDROP, backdropFilter: MODAL_BLUR }}
      >
      <div
        className="content-draft-shell"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{ width: "min(1220px, calc(100vw - 32px))", height: "min(880px, calc(100dvh - 32px))", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-sf)", border: "1px solid var(--bdh)", borderRadius: 2, boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}
      >
        <header style={{ minHeight: 54, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "8px 12px 8px 16px", background: "var(--bg-nb)", borderBottom: "1px solid var(--bd)" }}>
          <div className="content-draft-header-title" style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div id={titleId} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--t3)", fontSize: 9, fontWeight: 800, letterSpacing: ".08em" }}>
              {draft.kind === "article" ? "ARTICLE DRAFT" : "INSTAGRAM CAROUSEL"}
              {changed ? <span style={{ padding: "2px 5px", border: "1px solid rgba(255,184,77,.35)", color: "#ffbd66", letterSpacing: 0 }}>Sources changed</span> : null}
            </div>
            <input
              data-autofocus=""
              value={draft.name}
              maxLength={160}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              onBlur={(event) => {
                if (!event.currentTarget.value.trim()) onChange({ ...draft, name: draft.kind === "article" ? "Untitled article" : "Untitled carousel" });
              }}
              aria-label="Draft name"
              style={{ width: "min(340px, 100%)", maxWidth: "100%", marginTop: 3, padding: 0, border: 0, background: "transparent", color: "var(--t1)", outline: "none", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700 }}
            />
          </div>
          <div className="content-draft-header-actions" style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span role="status" style={{ marginRight: 4, color: saveState === "error" ? "var(--red)" : "var(--t3)", fontSize: 9.5 }}>{saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved locally"}</span>
            <button onClick={() => { setRailOpen((open) => !open); setSelectedMedia(null); }} aria-expanded={railOpen} aria-controls={sourcesId} style={{ ...chromeButton, background: railOpen ? "var(--bg-el)" : "transparent" }}>Sources</button>
            <button onClick={() => onRegenerate(draft)} style={chromeButton}>Regenerate</button>
            <button onClick={onDownloadCopy} style={{ ...chromeButton, border: 0, background: "var(--ac)", color: "#050505", fontWeight: 800 }}>Export copy</button>
            <button onClick={onClose} aria-label="Close draft editor" style={{ ...chromeButton, width: 32, padding: 0, fontSize: 17 }}>×</button>
          </div>
        </header>

        {draft.kind === "article" ? (
          <div className="content-draft-toolbar-row" style={{ minHeight: 42, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 12px", background: "var(--bg-in)", borderBottom: "1px solid var(--bd)" }}>
            <FormattingToolbar
              textarea={toolbarTextarea}
              onChange={(value) => {
                if (!activeSectionId || draft.kind !== "article") return;
                onChange({
                  ...draft,
                  content: {
                    ...draft.content,
                    sections: draft.content.sections.map((section) => section.id === activeSectionId ? { ...section, body: value } : section),
                  },
                });
              }}
              onAddSection={addSection}
            />
          </div>
        ) : null}

        <div className="content-draft-body" style={{ position: "relative", minHeight: 0, flex: 1, display: "flex" }}>
          <main style={{ minWidth: 0, flex: 1, overflowY: "auto", overscrollBehavior: "contain", background: "var(--bg)" }}>
            {draft.kind === "article" ? (
              <ArticleEditor
                draft={draft}
                photos={photos}
                onChange={onChange}
                railOpen={railOpen}
                selectedMedia={selectedMedia}
                onSelectMedia={(placement) => { setSelectedMedia(placement); if (placement) setRailOpen(true); }}
                onActivateBody={(sectionId, node) => {
                  setActiveTextarea(node);
                  setActiveSectionId(sectionId);
                }}
                onDeactivateBody={() => {
                  setActiveTextarea(null);
                  setActiveSectionId(null);
                }}
                onRequestRemoveSection={setSectionToDelete}
              />
            ) : <CarouselEditor draft={draft} photos={photos} onChange={onChange} />}
          </main>

          {railOpen ? (
            <aside id={sourcesId} className="content-draft-rail" style={{ width: 248, flex: "0 0 auto", overflowY: "auto", padding: 14, background: "var(--bg-nb)", borderLeft: "1px solid var(--bd)" }}>
              {draft.kind === "article" && selectedMedia
                ? <ImageSettings draft={draft} sectionId={selectedMedia.sectionId} assetId={selectedMedia.assetId} photos={photos} onChange={onChange} onDone={() => setSelectedMedia(null)} />
                : <SourcesRail draft={draft} photos={photos} onAddToArticle={addSourceToArticle} />}
            </aside>
          ) : null}
        </div>

        <footer style={{ minHeight: 48, flex: "0 0 auto", display: "flex", alignItems: "center", gap: 7, padding: "7px 12px 7px 16px", background: "var(--bg-nb)", borderTop: "1px solid var(--bd)" }}>
          <button onClick={onDelete} style={{ ...chromeButton, borderColor: "transparent", color: "var(--red)" }}>Delete draft</button>
          <span className="content-draft-footer-note" style={{ marginLeft: "auto", color: "var(--t3)", fontSize: 9.5 }}>Preview layout is saved with this draft</span>
          <button onClick={() => onDownloadPhotos(usedIds.length ? usedIds : draft.sourceSnapshot.assetIds)} style={chromeButton}>Download photos {usedIds.length || draft.sourceSnapshot.assetIds.length}</button>
        </footer>
        </div>
      </div>
      <ConfirmModal
        open={sectionToDelete !== null && deleteSection !== null}
        title={`Delete “${deleteSection?.heading.trim() || "Untitled section"}”?`}
        body={`This removes the section, its text, and ${deleteSection?.assetIds.length ?? 0} image placement${deleteSection?.assetIds.length === 1 ? "" : "s"}. Source photos stay available. This cannot be undone.`}
        confirmLabel="Delete section"
        danger
        onConfirm={confirmSectionDelete}
        onClose={() => setSectionToDelete(null)}
      />
    </>
  );
}
