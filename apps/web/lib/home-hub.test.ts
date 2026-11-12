import { describe, expect, it } from "vitest";
import { hubCreateChrome } from "./home-hub";

const BASE = { view: "projects" as const, activeCount: 0, query: "", creating: false, visibleCount: 0 };

describe("hubCreateChrome", () => {
  it("an empty hub shows only the first-project card", () => {
    expect(hubCreateChrome(BASE)).toEqual({
      headerButton: false,
      newCard: true,
      firstProject: true,
      emptyLine: "none",
      uploadMessage: "CREATE A PROJECT TO UPLOAD",
    });
  });

  it("with projects there is no idle ghost card — the header button is the door", () => {
    expect(hubCreateChrome({ ...BASE, activeCount: 3, visibleCount: 3 })).toEqual({
      headerButton: true,
      newCard: false,
      firstProject: false,
      emptyLine: "none",
      uploadMessage: "OPEN A PROJECT TO UPLOAD",
    });
  });

  it("creating with projects puts the form in the first cell and hides the header button", () => {
    const c = hubCreateChrome({ ...BASE, activeCount: 3, visibleCount: 3, creating: true });
    expect(c.headerButton).toBe(false);
    expect(c.newCard).toBe(true);
    expect(c.firstProject).toBe(false);
  });

  it("a search with no matches hides the idle card and says so", () => {
    const c = hubCreateChrome({ ...BASE, query: "zzz" });
    expect(c.newCard).toBe(false);
    expect(c.emptyLine).toBe("search");
    const withProjects = hubCreateChrome({ ...BASE, activeCount: 3, query: "zzz" });
    expect(withProjects.newCard).toBe(false);
    expect(withProjects.emptyLine).toBe("search");
    expect(withProjects.headerButton).toBe(true);
  });

  it("an open form survives a search", () => {
    const c = hubCreateChrome({ ...BASE, query: "zzz", creating: true });
    expect(c.newCard).toBe(true);
    expect(c.emptyLine).toBe("none");
    expect(hubCreateChrome({ ...BASE, activeCount: 3, query: "zzz", creating: true }).newCard).toBe(true);
  });

  it("a whitespace-only query counts as empty", () => {
    const c = hubCreateChrome({ ...BASE, query: "   " });
    expect(c.newCard).toBe(true);
    expect(c.emptyLine).toBe("none");
  });

  it("recents keeps the header button and never shows the card", () => {
    const empty = hubCreateChrome({ ...BASE, view: "recents" });
    expect(empty.headerButton).toBe(true);
    expect(empty.newCard).toBe(false);
    expect(empty.emptyLine).toBe("view");
    expect(hubCreateChrome({ ...BASE, view: "recents", activeCount: 2, creating: true }).headerButton).toBe(true);
  });

  it("archived shows neither control and its own empty line", () => {
    const c = hubCreateChrome({ ...BASE, view: "archived", activeCount: 2 });
    expect(c.headerButton).toBe(false);
    expect(c.newCard).toBe(false);
    expect(c.emptyLine).toBe("view");
  });

  it("trash and usage render their own bodies", () => {
    for (const view of ["trash", "usage"] as const) {
      const c = hubCreateChrome({ ...BASE, view });
      expect(c.emptyLine).toBe("none");
      expect(c.headerButton).toBe(false);
      expect(c.newCard).toBe(false);
    }
  });
});
