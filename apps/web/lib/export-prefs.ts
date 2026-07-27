import { artboardSettingsSchema, type ArtboardSettings } from "@archivemind/shared";

/** Export settings that are a PREFERENCE, not a per-export decision.
 *
 *  The dialog is mount-gated, so every setting reset on every open — a US user
 *  re-picked Letter each time, a photographer re-picked landscape each time. That
 *  is what made a nine-group form feel long: none of it was remembered.
 *
 *  localStorage rather than a column: this is per-user view state, the same class
 *  as canvas geometry (ADR 0022), and it needs no migration. Keyed per workspace
 *  like canvasStoreKey — a shared browser must not hand one archive's page size
 *  to the next.
 *
 *  `format` and `zipContents` are deliberately NOT persisted: a sticky 'zip'
 *  would make the drawer's Export button open a dialog titled "Export as ZIP"
 *  for a single photo. Format is a per-export decision by definition. */

const PREFIX = "archivemind:export:v1:";
const key = (workspaceId: string) => `${PREFIX}${workspaceId}`;

export type ExportPrefs = Pick<
  ArtboardSettings,
  "pageLayout" | "pageSize" | "orientation" | "captionLang" | "captionStyle" | "include" | "cover"
>;

/** Defaults straight from the contract, so the dialog and the worker cannot
 *  disagree about what "unset" means. */
export function defaultPrefs(): ExportPrefs {
  const d = artboardSettingsSchema.parse({});
  return {
    pageLayout: d.pageLayout,
    pageSize: d.pageSize,
    orientation: d.orientation,
    captionLang: d.captionLang,
    captionStyle: d.captionStyle,
    include: d.include,
    cover: d.cover,
  };
}

/** Read the stored preferences, or the defaults. `stored` distinguishes "the
 *  user chose these" from "nobody has chosen yet" — the caller seeds the caption
 *  language from the selection only in the second case, so an explicit choice is
 *  never overridden by a guess.
 *
 *  Anything unparseable — a blob from an older shape, a hand-edited value, a
 *  different app on the same origin — degrades to defaults rather than throwing:
 *  this runs inside a useState initialiser with no error boundary above it, so a
 *  throw would blank the export dialog entirely. */
export function loadPrefs(workspaceId: string): { prefs: ExportPrefs; stored: boolean } {
  const fallback = { prefs: defaultPrefs(), stored: false };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key(workspaceId));
    if (!raw) return fallback;
    const parsed = artboardSettingsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return fallback;
    const d = parsed.data;
    const prefs: ExportPrefs = {
      pageLayout: d.pageLayout,
      pageSize: d.pageSize,
      orientation: d.orientation,
      captionLang: d.captionLang,
      captionStyle: d.captionStyle,
      include: d.include,
      cover: d.cover,
    };
    return { prefs, stored: true };
  } catch {
    return fallback;
  }
}

/** Written after a SUCCESSFUL export, not on submit — settings that produced a
 *  failure are not worth remembering. */
export function savePrefs(workspaceId: string, prefs: ExportPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(workspaceId), JSON.stringify(prefs));
  } catch {
    // Private mode / quota. A preference that cannot be saved is not an error
    // worth surfacing — the export itself is unaffected.
  }
}

/** True when anything differs from the contract's defaults — the Page setup
 *  disclosure auto-expands on that, so a configured run always shows its
 *  configuration instead of hiding it behind a summary line. */
export function isNonDefaultPageSetup(prefs: Pick<ExportPrefs, "pageLayout" | "pageSize" | "orientation" | "cover">): boolean {
  const d = defaultPrefs();
  return (
    prefs.pageLayout !== d.pageLayout ||
    prefs.pageSize !== d.pageSize ||
    prefs.orientation !== d.orientation ||
    prefs.cover !== d.cover
  );
}
