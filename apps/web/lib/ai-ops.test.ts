import { describe, expect, it } from "vitest";
import { planAiRun } from "./ai-ops";

const IDS = ["a", "b", "c"];

describe("planAiRun", () => {
  it("analyze only: one analyze job, no caption leg", () => {
    const plan = planAiRun(IDS, { tags: true, captions: false }, [], "Agency");
    expect(plan.blocked).toBeNull();
    expect(plan.analyze).toEqual({ assetIds: IDS });
    expect(plan.caption).toBeNull();
    expect(plan.calls).toBe(3);
    expect(plan.cta).toBe("Analyze 3 photos");
  });

  it("captions only: a caption job with the DB-cased lang + style", () => {
    const plan = planAiRun(IDS, { tags: false, captions: true }, ["UK"], "Archival");
    expect(plan.analyze).toBeNull();
    expect(plan.caption).toEqual({ assetIds: IDS, langs: ["uk"], style: "archival" });
    expect(plan.cta).toBe("Caption 3 photos");
  });

  // The regression this whole module exists for: asking for captions must
  // actually produce a caption job. The old code path sent `analyze` and
  // nothing else, so the photo came back tagged and captionless.
  it("both ops: the caption leg survives alongside analyze", () => {
    const plan = planAiRun(IDS, { tags: true, captions: true }, ["EN", "UK"], "Agency");
    expect(plan.analyze).toEqual({ assetIds: IDS });
    expect(plan.caption).toEqual({ assetIds: IDS, langs: ["en", "uk"], style: "agency" });
    expect(plan.cta).toBe("Analyze & caption 3 photos");
  });

  it("counts one call per photo to analyze plus one per photo per language", () => {
    expect(planAiRun(IDS, { tags: true, captions: true }, ["EN", "UK"], "Agency").calls).toBe(9);
    expect(planAiRun(IDS, { tags: false, captions: true }, ["EN", "UK"], "Agency").calls).toBe(6);
    expect(planAiRun(["a"], { tags: true, captions: false }, [], "Agency").calls).toBe(1);
  });

  it("singularises the noun for one photo", () => {
    expect(planAiRun(["a"], { tags: true, captions: false }, [], "Agency").cta).toBe("Analyze 1 photo");
    expect(planAiRun(["a"], { tags: false, captions: true }, ["EN"], "Agency").cta).toBe("Caption 1 photo");
  });

  it("blocks an empty selection", () => {
    const plan = planAiRun([], { tags: true, captions: true }, ["EN"], "Agency");
    expect(plan.blocked).toBe("no-selection");
    expect(plan.analyze).toBeNull();
    expect(plan.caption).toBeNull();
    expect(plan.calls).toBe(0);
  });

  it("blocks when no operation is checked", () => {
    expect(planAiRun(IDS, { tags: false, captions: false }, ["EN"], "Agency").blocked).toBe("no-ops");
  });

  // Captions with zero languages would enqueue a job that generates nothing but
  // still counts progress units — the panel must refuse it up front.
  it("blocks captions with no language selected", () => {
    const plan = planAiRun(IDS, { tags: false, captions: true }, [], "Agency");
    expect(plan.blocked).toBe("no-langs");
    expect(plan.caption).toBeNull();
  });

  it("blocks captions-with-no-language even when analyze is also checked", () => {
    expect(planAiRun(IDS, { tags: true, captions: true }, [], "Agency").blocked).toBe("no-langs");
  });

  it("every style maps to its DB key", () => {
    const style = (s: "Social" | "Agency" | "Archival") =>
      planAiRun(["a"], { tags: false, captions: true }, ["EN"], s).caption?.style;
    expect(style("Social")).toBe("social");
    expect(style("Agency")).toBe("agency");
    expect(style("Archival")).toBe("archival");
  });
});
