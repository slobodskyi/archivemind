import { describe, expect, it } from "vitest";
import {
  parseShareCanvasParams,
  shareCanvasEndpoint,
  shareCanvasHref,
  shareCanvasScope,
  shareCanvasStamp,
  withoutShareCanvasParams,
} from "./share-canvas";

const project = "11111111-1111-4111-8111-111111111111";
const share = "33333333-3333-4333-8333-333333333333";
const board = "22222222-2222-4222-8222-222222222222";

describe("parseShareCanvasParams", () => {
  it("reads ?share= with its Workspace", () => {
    expect(parseShareCanvasParams({ share, board })).toEqual({ kind: "scope", shareId: share, boardId: board, at: null });
    expect(parseShareCanvasParams({ share })).toEqual({ kind: "scope", shareId: share, boardId: null, at: null });
  });

  it("keeps ?received= working", () => {
    expect(parseShareCanvasParams({ received: share })).toEqual({ kind: "received", shareId: share, at: null });
  });

  it("lets only uuids through, and ignores arrays and junk", () => {
    expect(parseShareCanvasParams({})).toBeNull();
    expect(parseShareCanvasParams({ share: "nope" })).toBeNull();
    expect(parseShareCanvasParams({ share: [share, share] })).toBeNull();
    expect(parseShareCanvasParams({ received: "1 or 1=1" })).toBeNull();
    // A malformed board is dropped, not the request.
    expect(parseShareCanvasParams({ share, board: "x" })).toEqual({ kind: "scope", shareId: share, boardId: null, at: null });
    expect(parseShareCanvasParams({ share, at: "<script>" })?.at).toBeNull();
  });

  it("prefers ?share= when both are written", () => {
    expect(parseShareCanvasParams({ share, received: board })?.kind).toBe("scope");
  });
});

describe("shareCanvasHref", () => {
  it("round-trips through the parser", () => {
    for (const request of [
      { kind: "scope", shareId: share, boardId: board, at: "mhx0a1" },
      { kind: "scope", shareId: share, boardId: null, at: null },
      { kind: "received", shareId: share, at: shareCanvasStamp(1_700_000_000_000) },
    ] as const) {
      const href = shareCanvasHref(project, request);
      expect(href.startsWith(`/projects/${project}?`)).toBe(true);
      const params = Object.fromEntries(new URL(href, "http://x").searchParams);
      expect(parseShareCanvasParams(params)).toEqual(request);
    }
  });

  it("writes no board for a link that has none", () => {
    expect(shareCanvasHref(project, { kind: "scope", shareId: share, boardId: null })).toBe(`/projects/${project}?share=${share}`);
  });
});

describe("shareCanvasStamp", () => {
  it("tells two clicks apart and survives the parser", () => {
    expect(shareCanvasStamp(1)).not.toBe(shareCanvasStamp(2));
    const stamp = shareCanvasStamp(1_700_000_000_000);
    expect(parseShareCanvasParams({ share, at: stamp })?.at).toBe(stamp);
  });
});

describe("shareCanvasEndpoint", () => {
  it("asks /scope for what a link carries and /received for what it brought in", () => {
    expect(shareCanvasEndpoint({ kind: "scope", shareId: share, boardId: board })).toBe(`/api/project-shares/${share}/scope`);
    expect(shareCanvasEndpoint({ kind: "received", shareId: share })).toBe(`/api/project-shares/${share}/received`);
  });
});

describe("shareCanvasScope", () => {
  it("opens the link's Workspace when the canvas has it", () => {
    expect(shareCanvasScope({ kind: "scope", shareId: share, boardId: board }, [board])).toBe(board);
  });

  it("falls back to the project for a Workspace in Trash, and for a project or list link", () => {
    expect(shareCanvasScope({ kind: "scope", shareId: share, boardId: board }, [])).toBeNull();
    expect(shareCanvasScope({ kind: "scope", shareId: share, boardId: null }, [board])).toBeNull();
  });

  it("leaves the scope alone for the received list", () => {
    expect(shareCanvasScope({ kind: "received", shareId: share }, [board])).toBeUndefined();
  });
});

describe("withoutShareCanvasParams", () => {
  it("drops this feature's keys and keeps everything else", () => {
    expect(withoutShareCanvasParams(`https://a.test/projects/${project}?share=${share}&board=${board}&at=k1&x=1#h`)).toBe(`/projects/${project}?x=1#h`);
    expect(withoutShareCanvasParams(`https://a.test/projects/${project}?received=${share}`)).toBe(`/projects/${project}`);
  });
});
