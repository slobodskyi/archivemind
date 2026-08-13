import type { ContentDraft } from "./content-drafts";
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

export function contentDraftFilename(draft: ContentDraft): string {
  return `${cleanFilename(draft.name)}.${draft.kind === "article" ? "md" : "txt"}`;
}

/** A portable text half of the final package. Source photos stay in the
 * existing, lossless Download flow; filenames here make their placement and
 * sequence explicit instead of baking temporary preview URLs into the copy. */
export function serializeContentDraft(draft: ContentDraft, photos: readonly Photo[]): string {
  if (draft.kind === "article") {
    const lines = [`# ${draft.content.title || draft.name}`];
    if (draft.content.dek) lines.push("", `> ${draft.content.dek}`);
    if (draft.content.intro) lines.push("", draft.content.intro);
    for (const section of draft.content.sections) {
      if (section.heading) lines.push("", `## ${section.heading}`);
      if (section.body) lines.push("", section.body);
      for (const assetId of section.assetIds) {
        lines.push("", `![${assetLabel(assetId, photos)}](images/${assetLabel(assetId, photos)})`);
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
