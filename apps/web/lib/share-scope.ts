import type { AssetLabel } from "@archivemind/shared";
import { PROJECT_SHARE_SELECTION_MAX, type ShareScope } from "./project-shares";

/** Which scopes a Share can start from (ADR 0053 §7). Pure, so every entry
 *  point — the header's SHARE, the canvas menu's Share N…, a Workspace chip's
 *  Share workspace… and the hub card — resolves the same way, and the same way
 *  Download does: the selection, else the open Workspace, else the project. */

export type ShareScopeOption =
  | {
      scope: "selection";
      assetIds: string[];
      count: number;
      /** Set when the list cannot be shared as one link; the option stays
       *  visible so the owner learns why rather than wondering where it went. */
      unavailable: string | null;
    }
  | { scope: "board"; boardId: string; name: string; color: AssetLabel | null; count: number; unavailable: null }
  | { scope: "project"; count: number | null; unavailable: null };

export interface ShareScopes {
  /** Narrowest first — the order the dialog lists them in. */
  options: ShareScopeOption[];
  /** The scope the dialog opens on. */
  initial: ShareScope;
}

export interface ResolveShareScopesInput {
  /** The canvas selection (or the right-clicked tile). Empty for none. */
  selectionIds: readonly string[];
  /** The Workspace open on the canvas, or the one whose chip was used. */
  activeBoard: { id: string; name: string; color: AssetLabel | null; count: number } | null;
  /** Files in the project, when known. */
  projectCount: number | null;
}

/** The options a Share offers, narrowest first, and the one it opens on: the
 *  narrowest available. Every option is a superset of the one before it, so
 *  the owner can always widen what they are about to send, never be surprised
 *  by something narrower. */
export function resolveShareScopes({ selectionIds, activeBoard, projectCount }: ResolveShareScopesInput): ShareScopes {
  const options: ShareScopeOption[] = [];
  const ids = [...new Set(selectionIds)];
  if (ids.length > 0) {
    options.push({
      scope: "selection",
      assetIds: ids,
      count: ids.length,
      unavailable:
        ids.length > PROJECT_SHARE_SELECTION_MAX
          ? `A list can hold up to ${PROJECT_SHARE_SELECTION_MAX.toLocaleString("en-US")} files. Share a Workspace instead.`
          : null,
    });
  }
  if (activeBoard) {
    options.push({
      scope: "board",
      boardId: activeBoard.id,
      name: activeBoard.name,
      color: activeBoard.color,
      count: activeBoard.count,
      unavailable: null,
    });
  }
  options.push({ scope: "project", count: projectCount, unavailable: null });
  const initial = options.find((option) => option.unavailable === null)?.scope ?? "project";
  return { options, initial };
}

export function countedFiles(count: number): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? "file" : "files"}`;
}

/** The short name of a scope: the link row's badge, the dialog's "What" row
 *  and the recipient page's kicker all say it the same way. A Workspace link
 *  whose Workspace is gone for good has no name left to show. */
export function shareScopeLabel(input: { scope: ShareScope; boardName?: string | null }): string {
  switch (input.scope) {
    case "project":
      return "Whole project";
    case "board":
      return input.boardName ? `Workspace · ${input.boardName}` : "Deleted workspace";
    case "selection":
      return "Selected files";
  }
}

/** The heading a scope reads as — the dialog's title and the `/s` page's h1.
 *  A Workspace link is titled by the Workspace (ADR 0053 §3: its name crosses
 *  as the title of the Workspace being shared); a list by its size. */
export function shareScopeHeading(input: {
  scope: ShareScope;
  projectName: string;
  boardName?: string | null;
  fileCount?: number | null;
}): string {
  switch (input.scope) {
    case "project":
      return input.projectName;
    case "board":
      return input.boardName || input.projectName;
    case "selection":
      return input.fileCount != null ? `${countedFiles(input.fileCount)} from ${input.projectName}` : `Files from ${input.projectName}`;
  }
}

/** The dialog's warning about a live link, naming what it follows (ADR 0053,
 *  Consequences). A list is the one scope that does not grow. */
export function shareScopeReach(option: ShareScopeOption, projectName: string): string {
  switch (option.scope) {
    case "project":
      return `A live link shows whatever “${projectName}” holds now, including files added after you send it.`;
    case "board":
      return `A live link shows whatever the Workspace “${option.name}” holds now, including files added to it later. Moving the Workspace to Trash pauses the link.`;
    case "selection":
      return `This link shows these ${countedFiles(option.count)} only — files added later never join it, and one moved to Trash leaves it.`;
  }
}
