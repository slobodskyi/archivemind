import { describe, expect, it } from "vitest";
import { keysBelongToOverlay } from "./key-owner";

const closed = { viewerId: null, editorId: null, importOpen: false };
/** A stand-in element: `inDialog` says whether a role="dialog" ancestor exists. */
const el = (inDialog: boolean) => ({
  closest: (selector: string) => (selector === '[role="dialog"]' && inDialog ? {} : null),
});

describe("keysBelongToOverlay", () => {
  it("gives the keyboard to the viewer, the image editor and the import modal while they are open", () => {
    expect(keysBelongToOverlay({ ...closed, viewerId: "a" }, el(false) as never)).toBe(true);
    expect(keysBelongToOverlay({ ...closed, editorId: "a" }, el(false) as never)).toBe(true);
    expect(keysBelongToOverlay({ ...closed, importOpen: true }, null)).toBe(true);
  });

  it("gives it to any dialog that holds the focus — a Backspace in Share must not trash the canvas", () => {
    expect(keysBelongToOverlay(closed, el(true) as never)).toBe(true);
  });

  it("leaves the canvas its keys otherwise", () => {
    expect(keysBelongToOverlay(closed, el(false) as never)).toBe(false);
    expect(keysBelongToOverlay(closed, null)).toBe(false);
    // `window` and `document` have no closest().
    expect(keysBelongToOverlay(closed, {} as never)).toBe(false);
  });
});
