import type { ArticleDraftContent } from "./content-drafts";

export type MarkdownCommand = "bold" | "italic" | "link" | "bullet" | "numbered" | "quote" | "heading3";

export interface MarkdownEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export type ArticleEditorSection = ArticleDraftContent["sections"][number];

function move<T>(values: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= values.length || values.length < 2) return [...values];
  const destination = Math.max(0, Math.min(to, values.length - 1));
  const next = [...values];
  const [item] = next.splice(from, 1);
  next.splice(destination, 0, item);
  return next;
}

/** Whether removing a section needs a destructive-action guard. Whitespace-only
 * generated placeholders are safe to remove; text or a placed source is work. */
export function articleSectionHasContent(section: ArticleEditorSection): boolean {
  return Boolean(
    section.heading.trim() ||
    section.body.trim() ||
    section.assetIds.length ||
    section.media.length,
  );
}

/** Remove one placement from both parallel representations. `assetIds` remains
 * the generation/export contract while `media` carries editorial presentation,
 * so changing only one would either resurrect the image or discard its layout. */
export function removeArticlePlacement(
  sections: ArticleEditorSection[],
  sectionId: string,
  assetId: string,
): ArticleEditorSection[] {
  const section = sections.find((item) => item.id === sectionId);
  if (!section || !section.assetIds.includes(assetId) || !section.media.some((item) => item.assetId === assetId)) {
    return sections;
  }
  return sections.map((item) => item.id === sectionId
    ? {
        ...item,
        assetIds: item.assetIds.filter((id) => id !== assetId),
        media: item.media.filter((placement) => placement.assetId !== assetId),
      }
    : item);
}

/** Reorder a placement within one section without letting `assetIds` and media
 * presentation drift into different sequences. Out-of-range destinations clamp
 * to an edge, which is useful for keyboard "first/last" commands. */
export function reorderArticlePlacement(
  sections: ArticleEditorSection[],
  sectionId: string,
  assetId: string,
  destination: number,
): ArticleEditorSection[] {
  const section = sections.find((item) => item.id === sectionId);
  const from = section?.assetIds.indexOf(assetId) ?? -1;
  const mediaFrom = section?.media.findIndex((item) => item.assetId === assetId) ?? -1;
  if (!section || from < 0 || mediaFrom < 0) return sections;
  const target = Math.max(0, Math.min(destination, section.assetIds.length - 1));
  if (from === target && mediaFrom === target) return sections;
  return sections.map((item) => item.id === sectionId
    ? {
        ...item,
        assetIds: move(item.assetIds, from, target),
        media: move(item.media, mediaFrom, target),
      }
    : item);
}

/** Move one image, with its exact caption/alt/crop settings, between sections.
 * A destination that already contains the image is deliberately a no-op: the
 * section schema requires unique ids and silently choosing which layout wins
 * would lose editorial work. */
export function moveArticlePlacement(
  sections: ArticleEditorSection[],
  sourceSectionId: string,
  targetSectionId: string,
  assetId: string,
  destination: number,
): ArticleEditorSection[] {
  if (sourceSectionId === targetSectionId) {
    return reorderArticlePlacement(sections, sourceSectionId, assetId, destination);
  }
  const source = sections.find((item) => item.id === sourceSectionId);
  const target = sections.find((item) => item.id === targetSectionId);
  const placement = source?.media.find((item) => item.assetId === assetId);
  if (
    !source ||
    !target ||
    !placement ||
    !source.assetIds.includes(assetId) ||
    target.assetIds.includes(assetId) ||
    target.media.some((item) => item.assetId === assetId)
  ) {
    return sections;
  }

  const targetIndex = Math.max(0, Math.min(destination, target.assetIds.length));
  return sections.map((section) => {
    if (section.id === sourceSectionId) {
      return {
        ...section,
        assetIds: section.assetIds.filter((id) => id !== assetId),
        media: section.media.filter((item) => item.assetId !== assetId),
      };
    }
    if (section.id === targetSectionId) {
      const assetIds = [...section.assetIds];
      const media = [...section.media];
      assetIds.splice(targetIndex, 0, assetId);
      media.splice(targetIndex, 0, placement);
      return { ...section, assetIds, media };
    }
    return section;
  });
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  prefix: string,
  suffix: string,
  placeholder: string,
): MarkdownEdit {
  const selected = value.slice(start, end);
  const hasWrapper =
    start >= prefix.length &&
    value.slice(start - prefix.length, start) === prefix &&
    value.slice(end, end + suffix.length) === suffix;

  if (selected && hasWrapper) {
    return {
      value: `${value.slice(0, start - prefix.length)}${selected}${value.slice(end + suffix.length)}`,
      selectionStart: start - prefix.length,
      selectionEnd: end - prefix.length,
    };
  }

  const content = selected || placeholder;
  const next = `${value.slice(0, start)}${prefix}${content}${suffix}${value.slice(end)}`;
  return {
    value: next,
    selectionStart: start + prefix.length,
    selectionEnd: start + prefix.length + content.length,
  };
}

function editSelectedLines(
  value: string,
  start: number,
  end: number,
  prefixFor: (index: number) => string,
): MarkdownEdit {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf("\n", end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const selected = value.slice(lineStart, lineEnd);
  const lines = selected.split("\n");
  const prefixes = lines.map((_, index) => prefixFor(index));
  const alreadyPrefixed = lines.every((line, index) => line.startsWith(prefixes[index]));
  const edited = lines
    .map((line, index) => alreadyPrefixed ? line.slice(prefixes[index].length) : `${prefixes[index]}${line}`)
    .join("\n");
  const next = `${value.slice(0, lineStart)}${edited}${value.slice(lineEnd)}`;

  return {
    value: next,
    selectionStart: lineStart,
    selectionEnd: lineStart + edited.length,
  };
}

/** Minimal Markdown-ish editing for a structured article. The domain remains
 * plain text: these helpers only transform the current selection and return a
 * deterministic caret range, avoiding contentEditable/HTML persistence. */
export function applyMarkdownCommand(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  command: MarkdownCommand,
): MarkdownEdit {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));

  switch (command) {
    case "bold":
      return wrapSelection(value, start, end, "**", "**", "bold text");
    case "italic":
      return wrapSelection(value, start, end, "_", "_", "italic text");
    case "link": {
      const selected = value.slice(start, end) || "link text";
      const inserted = `[${selected}](https://)`;
      return {
        value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
        selectionStart: start + selected.length + 3,
        selectionEnd: start + selected.length + 11,
      };
    }
    case "bullet":
      return editSelectedLines(value, start, end, () => "- ");
    case "numbered":
      return editSelectedLines(value, start, end, (index) => `${index + 1}. `);
    case "quote":
      return editSelectedLines(value, start, end, () => "> ");
    case "heading3":
      return editSelectedLines(value, start, end, () => "### ");
  }
}
