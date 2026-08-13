import {
  DEFAULT_ARTICLE_MEDIA_PRESENTATION,
  type ArticleDraftMedia,
  type ContentDraft,
} from "./content-drafts";
import type { Photo } from "../types";

function cleanFilename(value: string): string {
  const clean = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 100);
  return clean || "untitled";
}

function assetLabel(assetId: string, photos: readonly Photo[]): string {
  return photos.find((photo) => photo.id === assetId)?.filename ?? assetId;
}

function uniquePackageNames(assetIds: readonly string[], photos: readonly Photo[]): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const assetId of assetIds) {
    if (names.has(assetId)) continue;
    const base = assetLabel(assetId, photos);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const extension = dot > 0 ? base.slice(dot) : "";
    let candidate = base;
    let number = 2;
    while (taken.has(candidate.toLocaleLowerCase())) {
      candidate = `${stem} (${number})${extension}`;
      number += 1;
    }
    taken.add(candidate.toLocaleLowerCase());
    names.set(assetId, candidate);
  }
  return names;
}

function markdownAlt(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

function hasCustomPresentation(media: ArticleDraftMedia): boolean {
  const { presentation } = media;
  return (
    presentation.width !== DEFAULT_ARTICLE_MEDIA_PRESENTATION.width ||
    presentation.alignment !== DEFAULT_ARTICLE_MEDIA_PRESENTATION.alignment ||
    presentation.aspect !== DEFAULT_ARTICLE_MEDIA_PRESENTATION.aspect ||
    presentation.fit !== DEFAULT_ARTICLE_MEDIA_PRESENTATION.fit ||
    presentation.focalPoint.x !== DEFAULT_ARTICLE_MEDIA_PRESENTATION.focalPoint.x ||
    presentation.focalPoint.y !== DEFAULT_ARTICLE_MEDIA_PRESENTATION.focalPoint.y
  );
}

function serializeArticleMedia(media: ArticleDraftMedia, filename: string): string[] {
  const lines: string[] = [];
  if (hasCustomPresentation(media)) {
    // Markdown has no portable crop/alignment vocabulary. The inert comment
    // keeps editor choices available to a future renderer without making the
    // copy unreadable in ordinary Markdown tools.
    lines.push(`<!-- archivemind:media ${JSON.stringify(media.presentation)} -->`);
  }
  lines.push(`![${markdownAlt(media.altText || filename)}](images/${filename})`);
  if (media.caption.trim()) lines.push(`_${media.caption.trim()}_`);
  return lines;
}

export function contentDraftFilename(draft: ContentDraft): string {
  return `${cleanFilename(draft.name)}.${draft.kind === "article" ? "md" : "txt"}`;
}

/** A portable text half of the final package. Source photos stay in the
 * existing, lossless Download flow; filenames here make their placement and
 * sequence explicit instead of baking temporary preview URLs into the copy. */
export function serializeContentDraft(draft: ContentDraft, photos: readonly Photo[]): string {
  if (draft.kind === "article") {
    const packageNames = uniquePackageNames(usedAssetIds(draft), photos);
    const lines = [`# ${draft.content.title || draft.name}`];
    if (draft.content.dek) lines.push("", `> ${draft.content.dek}`);
    if (draft.content.intro) lines.push("", draft.content.intro);
    for (const section of draft.content.sections) {
      if (section.heading) lines.push("", `## ${section.heading}`);
      if (section.body) lines.push("", section.body);
      for (const media of section.media) {
        lines.push("", ...serializeArticleMedia(media, packageNames.get(media.assetId) ?? media.assetId));
      }
    }
    if (draft.content.socialExcerpt) {
      lines.push("", "---", "", "## Social excerpt", "", draft.content.socialExcerpt);
    }
    return `${lines.join("\n")}\n`;
  }

  const lines = draft.content.slides.flatMap((slide, index) => [
    `SLIDE ${index + 1}${slide.assetId ? ` · ${assetLabel(slide.assetId, photos)}` : ""}`,
    slide.headline,
    slide.body,
    "",
  ]);
  lines.push("CAPTION", draft.content.caption, "", "HASHTAGS", draft.content.hashtags.join(" "));
  return `${lines.join("\n").trim()}\n`;
}

export function downloadContentDraft(draft: ContentDraft, photos: readonly Photo[]): void {
  const blob = new Blob([serializeContentDraft(draft, photos)], {
    type: draft.kind === "article" ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = contentDraftFilename(draft);
  anchor.click();
  URL.revokeObjectURL(url);
}

export function usedAssetIds(draft: ContentDraft): string[] {
  const ids =
    draft.kind === "article"
      ? draft.content.sections.flatMap((section) => section.assetIds)
      : draft.content.slides.flatMap((slide) => (slide.assetId ? [slide.assetId] : []));
  return [...new Set(ids)];
}
