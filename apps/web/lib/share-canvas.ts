import { uuidSchema } from "@archivemind/shared";

/** "Show on canvas" from the Share dialog (ADR 0051 §12, ADR 0053 §6): the
 *  canvas opens with a link's files selected. Two questions, two addresses:
 *
 *  - `?share={id}` — what the link CARRIES right now (any link). A Workspace
 *    link adds `&board={id}` so the canvas opens that Workspace first; any
 *    other link opens the project, since a list or a whole project is not
 *    inside one Workspace.
 *  - `?received={id}` — what the link brought IN (a link that took uploads).
 *    It leaves the scope as it is, as it always has.
 *
 *  Pure, so the parse, the endpoint and the clean-up are tested without a
 *  canvas. */
export type ShareCanvasRequest = (
  | { kind: "scope"; shareId: string; boardId: string | null }
  | { kind: "received"; shareId: string }
) & {
  /** `?at=` — which click this is. The address is cleaned after the
   *  selection, but the canvas's props are not, so a second "Show on canvas"
   *  for the same link would otherwise look like no change at all. */
  at?: string | null;
};

/** Every query key this feature writes, so the clean-up removes exactly these. */
export const SHARE_CANVAS_PARAMS = ["share", "board", "received", "at"] as const;

const AT_PATTERN = /^[0-9a-z]{1,16}$/;

type SearchParams = Record<string, string | string[] | undefined>;

function uuidParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" && uuidSchema.safeParse(value).success ? value : null;
}

/** Read the canvas's search params. Only uuids pass — the route checks the
 *  rest. `share` wins if somebody hand-writes both. */
export function parseShareCanvasParams(params: SearchParams): ShareCanvasRequest | null {
  const at = typeof params.at === "string" && AT_PATTERN.test(params.at) ? params.at : null;
  const share = uuidParam(params.share);
  if (share) return { kind: "scope", shareId: share, boardId: uuidParam(params.board), at };
  const received = uuidParam(params.received);
  return received ? { kind: "received", shareId: received, at } : null;
}

/** A fresh `at` for one click. */
export function shareCanvasStamp(now: number = Date.now()): string {
  return now.toString(36);
}

export function shareCanvasHref(projectId: string, request: ShareCanvasRequest): string {
  const query = new URLSearchParams();
  if (request.kind === "scope") {
    query.set("share", request.shareId);
    if (request.boardId) query.set("board", request.boardId);
  } else {
    query.set("received", request.shareId);
  }
  if (request.at) query.set("at", request.at);
  return `/projects/${encodeURIComponent(projectId)}?${query.toString()}`;
}

/** Which route answers the request. Both reply `{ assetIds }`. */
export function shareCanvasEndpoint(request: ShareCanvasRequest): string {
  const id = encodeURIComponent(request.shareId);
  return `/api/project-shares/${id}/${request.kind === "scope" ? "scope" : "received"}`;
}

/** The address with this feature's keys dropped, so a reload does not select
 *  the same files again. Keeps every other key and the hash. */
export function withoutShareCanvasParams(href: string): string {
  const url = new URL(href);
  for (const key of SHARE_CANVAS_PARAMS) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Which scope the canvas should be on before selecting: the link's
 *  Workspace if it still has one on this canvas, else the whole project.
 *  `undefined` means "leave the scope alone" — the received list, which has
 *  always selected in place. */
export function shareCanvasScope(request: ShareCanvasRequest, liveBoardIds: readonly string[]): string | null | undefined {
  if (request.kind === "received") return undefined;
  return request.boardId && liveBoardIds.includes(request.boardId) ? request.boardId : null;
}
