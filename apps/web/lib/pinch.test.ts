import { describe, expect, it } from "vitest";
import { latestPointerPosition, solvePinch } from "./pinch";

describe("latestPointerPosition", () => {
  it("uses the freshest coalesced pointer sample", () => {
    expect(
      latestPointerPosition({
        clientX: 10,
        clientY: 20,
        getCoalescedEvents: () => [
          { clientX: 12, clientY: 22 },
          { clientX: 18, clientY: 28 },
        ],
      }),
    ).toEqual({ x: 18, y: 28 });
  });

  it("falls back to the pointer event when no samples were coalesced", () => {
    expect(latestPointerPosition({ clientX: 10, clientY: 20 })).toEqual({ x: 10, y: 20 });
  });
});

describe("solvePinch", () => {
  const snapshot = { dist: 100, cx: 150, cy: 100, scale: 1, tx: 0, ty: 0 };

  it("keeps the original midpoint content anchored during a symmetric zoom", () => {
    expect(solvePinch(snapshot, { x: 50, y: 100 }, { x: 250, y: 100 }, { left: 0, top: 0 })).toEqual({
      scale: 2,
      tx: -150,
      ty: -100,
    });
  });

  it("turns equal two-finger movement into a pan without changing scale", () => {
    expect(solvePinch(snapshot, { x: 120, y: 130 }, { x: 220, y: 130 }, { left: 0, top: 0 })).toEqual({
      scale: 1,
      tx: 20,
      ty: 30,
    });
  });

  it("respects canvas offsets and zoom limits", () => {
    const camera = solvePinch(
      { dist: 10, cx: 60, cy: 70, scale: 3, tx: 10, ty: 20 },
      { x: -440, y: 70 },
      { x: 560, y: 70 },
      { left: 10, top: 20 },
    );
    expect(camera?.scale).toBe(4);
    expect(camera && Object.values(camera).every(Number.isFinite)).toBe(true);
  });

  it("rejects degenerate gestures", () => {
    expect(solvePinch(snapshot, { x: 1, y: 1 }, { x: 1, y: 1 }, { left: 0, top: 0 })).toBeNull();
  });
});
