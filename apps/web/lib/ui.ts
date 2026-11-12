/** Shared chrome tokens (2026-07-11 UI-consistency audit).
 *
 *  Z ladder — every fixed/overlay surface picks from here instead of ad-hoc
 *  numbers (the audit found a toast wedged *between* two modals at 58/60/65):
 *  canvas internals stay 0–35, header 40, drawer/sidebar 45, menus 60,
 *  modals 70, toasts 80, tooltip 85 (cursor-attached, tops toasts),
 *  upload drop overlay 90 (the upload pill lives at 34, inside the canvas
 *  band), nav progress bar 130. */
export const Z = {
  header: 40,
  drawer: 45,
  /** Dropdowns + popovers; their click-away backdrop sits one below. */
  menu: 60,
  menuBackdrop: 59,
  modal: 70,
  toast: 80,
  tooltip: 85,
  uploadOverlay: 90,
  /** Under the canvas bars (35) and BulkAiPanel (36) on purpose: it docks
   *  above them (UploadManager), and if anything still overlaps, the control
   *  wins. NOT below everything: the Map pane is its own stacking context at
   *  z 5, so its photos-at-this-spot stack paints under this pill whatever its
   *  own z. That panel (`am-map-stack`) is docked above instead, and announces
   *  its mount/unmount with `BOTTOM_CHROME_EVENT`. */
  uploadPill: 34,
  navProgress: 130,
} as const;

/** Window event a piece of bottom chrome that mounts and unmounts on its own
 *  (the Map's stack panel) fires, so the upload pill re-queries what it docks
 *  above. The bars change with props the pill already keys on; this does not. */
export const BOTTOM_CHROME_EVENT = "am:bottom-chrome-change";

export function announceBottomChromeChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(BOTTOM_CHROME_EVENT));
}

/** One modal shell: Search/Help/Import diverged on backdrop (.45/.62/.7),
 *  blur (2/6), radius (2/4) and z (58/65/100). */
export const MODAL_BACKDROP = "rgba(0,0,0,.62)";
export const MODAL_BLUR = "blur(2px)";

/** The floating surface every dropdown and popover is drawn on — the dark
 *  translucent card with the blur and the long shadow. It was copy-pasted at
 *  each call site, which is how two menus in the same header end up a shade
 *  apart. Spread it, then add position/size. */
export const POPOVER_SURFACE = {
  background: "rgba(18,18,18,.97)",
  border: "1px solid var(--bdh)",
  borderRadius: 2,
  backdropFilter: "blur(20px)",
  boxShadow: "0 20px 60px rgba(0,0,0,.7)",
  zIndex: Z.menu,
} as const;
