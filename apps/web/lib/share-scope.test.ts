import { describe, expect, it } from "vitest";
import {
  countedFiles,
  resolveShareScopes,
  shareScopeHeading,
  shareScopeLabel,
  shareScopeReach,
  shareDetailsLabel,
} from "./share-scope";

const board = { id: "11111111-1111-4111-8111-111111111111", name: "Kyiv", color: "blue" as const, count: 48 };

describe("resolveShareScopes", () => {
  it("opens on the selection, then offers the Workspace and the project — narrowest first", () => {
    const { options, initial } = resolveShareScopes({ selectionIds: ["a", "b", "a"], activeBoard: board, projectCount: 412 });
    expect(initial).toBe("selection");
    expect(options.map((o) => o.scope)).toEqual(["selection", "board", "project"]);
    expect(options[0]).toMatchObject({ assetIds: ["a", "b"], count: 2, unavailable: null });
    expect(options[1]).toMatchObject({ boardId: board.id, name: "Kyiv", count: 48 });
    expect(options[2]).toMatchObject({ count: 412 });
  });

  it("opens on the Workspace without a selection", () => {
    const { options, initial } = resolveShareScopes({ selectionIds: [], activeBoard: board, projectCount: null });
    expect(initial).toBe("board");
    expect(options.map((o) => o.scope)).toEqual(["board", "project"]);
  });

  it("is the project alone from the hub", () => {
    expect(resolveShareScopes({ selectionIds: [], activeBoard: null, projectCount: 9 })).toEqual({
      options: [{ scope: "project", count: 9, unavailable: null }],
      initial: "project",
    });
  });

  it("keeps a list over the cap visible but skips it as the default", () => {
    const ids = Array.from({ length: 2001 }, (_, i) => `id-${i}`);
    const { options, initial } = resolveShareScopes({ selectionIds: ids, activeBoard: null, projectCount: 3000 });
    expect(options[0].scope).toBe("selection");
    expect(options[0].unavailable).toMatch(/2,000/);
    expect(initial).toBe("project");
  });

  it("allows exactly the cap", () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `id-${i}`);
    expect(resolveShareScopes({ selectionIds: ids, activeBoard: null, projectCount: null }).initial).toBe("selection");
  });
});

describe("scope copy", () => {
  it("labels each scope, and a Workspace gone for good", () => {
    expect(shareScopeLabel({ scope: "project" })).toBe("Whole project");
    expect(shareScopeLabel({ scope: "board", boardName: "Kyiv" })).toBe("Workspace · Kyiv");
    expect(shareScopeLabel({ scope: "board", boardName: null })).toBe("Deleted workspace");
    expect(shareScopeLabel({ scope: "selection" })).toBe("Selected files");
  });

  it("heads a page by what it carries", () => {
    expect(shareScopeHeading({ scope: "project", projectName: "Frontline" })).toBe("Frontline");
    expect(shareScopeHeading({ scope: "board", projectName: "Frontline", boardName: "Kyiv" })).toBe("Kyiv");
    expect(shareScopeHeading({ scope: "board", projectName: "Frontline", boardName: null })).toBe("Frontline");
    expect(shareScopeHeading({ scope: "selection", projectName: "Frontline", fileCount: 1 })).toBe("1 file from Frontline");
    expect(shareScopeHeading({ scope: "selection", projectName: "Frontline", fileCount: null })).toBe("Files from Frontline");
  });

  it("warns that a list does not grow, and the live scopes do", () => {
    const [selection, ws, project] = resolveShareScopes({ selectionIds: ["a", "b"], activeBoard: board, projectCount: 5 }).options;
    expect(shareScopeReach(selection, "P")).toContain("these 2 files only");
    expect(shareScopeReach(ws, "P")).toContain("Workspace “Kyiv” holds now");
    expect(shareScopeReach(project, "P")).toContain("“P” holds now");
    expect(countedFiles(1200)).toBe("1,200 files");
  });
});

describe("shareDetailsLabel", () => {
  it("says nothing for a link that shows files only", () => {
    expect(shareDetailsLabel({ boards: false, labels: false, tags: false, caption: null })).toBeNull();
  });

  it("names every detail a link shows, the caption by language and style", () => {
    expect(
      shareDetailsLabel({ boards: true, labels: true, tags: true, caption: { lang: "uk", style: "agency" } }),
    ).toBe("Shows Workspaces · colour labels · tags · Ukrainian agency caption");
    expect(shareDetailsLabel({ boards: false, labels: true, tags: false, caption: null })).toBe("Shows colour labels");
  });
});
