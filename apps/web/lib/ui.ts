/** Shared chrome tokens (2026-07-11 UI-consistency audit).
 *
 *  Z ladder — every fixed/overlay surface picks from here instead of ad-hoc
 *  numbers (the audit found a toast wedged *between* two modals at 58/60/65):
 *  canvas internals stay 0–35, header 40, drawer/sidebar 45, menus 60,
 *  modals 70, toasts 80, tooltip 85 (cursor-attached, tops toasts),
 *  upload overlay/pill 90/91, nav progress bar 130. */
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
  uploadPill: 91,
  navProgress: 130,
} as const;

/** One modal shell: Search/Help/Import diverged on backdrop (.45/.62/.7),
 *  blur (2/6), radius (2/4) and z (58/65/100). */
export const MODAL_BACKDROP = "rgba(0,0,0,.62)";
export const MODAL_BLUR = "blur(2px)";
