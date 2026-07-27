import { beforeEach, describe, expect, it } from "vitest";
import { defaultPrefs, isNonDefaultPageSetup, loadPrefs, savePrefs } from "./export-prefs";

const WS = "00000000-0000-0000-0000-00000000aaaa";
const KEY = `archivemind:export:v1:${WS}`;

/** These tests run in vitest's node environment — no DOM. The module reads
 *  `window` at call time, so a minimal stand-in is enough and keeps the suite
 *  free of a jsdom dependency the repo does not otherwise need. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };
  return store;
}

let store: Map<string, string>;
beforeEach(() => {
  store = stubStorage();
});

describe("loadPrefs", () => {
  it("reports stored=false when nobody has chosen yet", () => {
    // The caller seeds the caption language from the selection only in this
    // case — an explicit choice must never be overridden by a guess.
    const { prefs, stored } = loadPrefs(WS);
    expect(stored).toBe(false);
    expect(prefs).toEqual(defaultPrefs());
  });

  it("round-trips what was saved", () => {
    const next = { ...defaultPrefs(), pageSize: "Letter" as const, orientation: "landscape" as const, cover: true };
    savePrefs(WS, next);
    const { prefs, stored } = loadPrefs(WS);
    expect(stored).toBe(true);
    expect(prefs).toEqual(next);
  });

  it("is scoped per workspace — a shared browser must not leak one archive's setup", () => {
    savePrefs(WS, { ...defaultPrefs(), pageSize: "Letter" });
    expect(loadPrefs("00000000-0000-0000-0000-00000000bbbb").stored).toBe(false);
  });

  it("degrades to defaults on a corrupt or foreign blob instead of throwing", () => {
    // This runs inside a useState initialiser with no error boundary above it,
    // so a throw would blank the export dialog entirely.
    store.set(KEY, "{not json");
    expect(loadPrefs(WS)).toEqual({ prefs: defaultPrefs(), stored: false });
    store.set(KEY, JSON.stringify({ pageSize: "A3" }));
    expect(loadPrefs(WS)).toEqual({ prefs: defaultPrefs(), stored: false });
  });

  it("fills gaps from the contract, so an older partial blob still loads", () => {
    store.set(KEY, JSON.stringify({ pageSize: "Letter" }));
    const { prefs, stored } = loadPrefs(WS);
    expect(stored).toBe(true);
    expect(prefs.pageSize).toBe("Letter");
    expect(prefs.orientation).toBe(defaultPrefs().orientation);
  });

  it("never persists format — a sticky 'zip' would retitle the drawer's export", () => {
    savePrefs(WS, defaultPrefs());
    expect(store.get(KEY)).not.toContain("format");
    expect(store.get(KEY)).not.toContain("zipContents");
  });
});

describe("isNonDefaultPageSetup", () => {
  it("is false for the defaults, so the disclosure starts collapsed", () => {
    expect(isNonDefaultPageSetup(defaultPrefs())).toBe(false);
  });

  it("is true for any changed value, so a configured run shows its configuration", () => {
    for (const patch of [
      { pageSize: "Letter" as const },
      { orientation: "landscape" as const },
      { pageLayout: "grid" as const },
      { cover: true },
    ]) {
      expect(isNonDefaultPageSetup({ ...defaultPrefs(), ...patch })).toBe(true);
    }
  });
});
