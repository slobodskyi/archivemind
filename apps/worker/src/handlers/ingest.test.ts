import { describe, expect, it } from "vitest";
import { dedupDecision, ingestProgressLabel, isWhollyFailed } from "./ingest";

describe("dedupDecision (#118 + data-loss guards)", () => {
  // Legend: dedupDecision(survivorStatus, survivorDurable, incomingDurable)
  //   durable = the file holds a durable original in R2 (upload / Dropbox);
  //   a Drive row is never durable (r2_key null, ADR 0025).

  it("merges a plain duplicate into a healthy active survivor", () => {
    expect(dedupDecision("active", true, true)).toBe("merge");
    expect(dedupDecision("active", true, false)).toBe("merge");
  });

  it("merges two byte-less copies (both Drive links) — nothing durable to lose", () => {
    expect(dedupDecision("active", false, false)).toBe("merge");
  });

  it("revives a soft-deleted survivor that still has durable bytes", () => {
    // "I re-uploaded it to get it back" — reactivate rather than merge INTO a
    // tombstone (the #118 bug), safe because the survivor's bytes are intact.
    expect(dedupDecision("deleted", true, true)).toBe("revive-merge");
    expect(dedupDecision("deleted", false, false)).toBe("revive-merge");
  });

  it("NEVER drops the incoming durable original for a byte-less survivor", () => {
    // The data-loss finding: an upload (durable) dedup'ing against a Drive
    // survivor (no R2 bytes) must keep the durable copy, not destroy it.
    expect(dedupDecision("active", false, true)).toBe("stand-alone");
    expect(dedupDecision("deleted", false, true)).toBe("stand-alone");
  });

  it("never folds a fresh copy into a source_missing record — its source is gone", () => {
    expect(dedupDecision("source_missing", false, true)).toBe("stand-alone");
    expect(dedupDecision("source_missing", false, false)).toBe("stand-alone");
    expect(dedupDecision("source_missing", true, true)).toBe("stand-alone");
  });

  it("treats an unknown future status as a non-active survivor (fail safe)", () => {
    expect(dedupDecision("some_new_status", true, true)).toBe("revive-merge");
    expect(dedupDecision("some_new_status", false, true)).toBe("stand-alone");
  });
});

describe("isWhollyFailed (#119)", () => {
  it("is false for an empty batch — nothing to fail", () => {
    expect(isWhollyFailed(0, 0)).toBe(false);
  });

  it("is true only when every processed row genuinely failed", () => {
    expect(isWhollyFailed(50, 50)).toBe(true);
    expect(isWhollyFailed(1, 1)).toBe(true);
  });

  it("is false when anything survived or was handled (dedup / other / missing / success)", () => {
    expect(isWhollyFailed(50, 0)).toBe(false); // all clean
    expect(isWhollyFailed(50, 49)).toBe(false); // one survived — stays 'done'
    expect(isWhollyFailed(50, 2)).toBe(false); // partial failure — stays 'done'
    // source_missing counts as `missing`, not `failed`, so an all-missing batch
    // (failed=0) is NOT wholly failed — it completes 'done', no wasteful retry.
    expect(isWhollyFailed(5, 0)).toBe(false);
  });

  it("never fails a batch on a stale count larger than the total", () => {
    expect(isWhollyFailed(3, 5)).toBe(false);
  });
});

describe("ingestProgressLabel", () => {
  it("reports a clean run with no tail", () => {
    expect(ingestProgressLabel(10, 0, 0, 0)).toBe("Processed 10 file(s)");
  });

  it("appends each non-zero count in order", () => {
    expect(ingestProgressLabel(10, 3, 0, 0)).toBe("Processed 10 file(s) (3 deduped)");
    expect(ingestProgressLabel(10, 0, 2, 0)).toBe("Processed 10 file(s) (2 failed)");
    expect(ingestProgressLabel(10, 0, 0, 4)).toBe("Processed 10 file(s) (4 missing)");
    expect(ingestProgressLabel(10, 3, 2, 4)).toBe("Processed 10 file(s) (3 deduped, 2 failed, 4 missing)");
  });
});
