import { describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, RETRY_BASE_MS, retryDelayMs } from "./queue";

/** Pure queue policy (ADR 0013 layer 2) — spec §7:
 *  attempts < 3 → requeue with attempts*2min backoff; attempts ≥ 3 → failed. */
describe("retryDelayMs", () => {
  it("backs off linearly per completed attempt", () => {
    expect(retryDelayMs(1)).toBe(1 * RETRY_BASE_MS); // 2 min after first failure
    expect(retryDelayMs(2)).toBe(2 * RETRY_BASE_MS); // 4 min after second
  });

  it("fails permanently at MAX_ATTEMPTS", () => {
    expect(retryDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(retryDelayMs(MAX_ATTEMPTS + 5)).toBeNull();
  });

  it("never returns a negative or zero delay for a claimed job", () => {
    // attempts is incremented AT claim time, so a failing run always has ≥ 1.
    expect(retryDelayMs(1)).toBeGreaterThan(0);
  });
});
