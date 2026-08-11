import LandingShell from "./LandingShell";

/** Server half of the landing: it owns the render-time values the client shell
 *  shouldn't compute itself.
 *
 *  The app is set in Space Mono, which is right for a workspace and wrong for a
 *  headline you want read from across the room. Inter Tight carries the
 *  frame.io-ish register — a tight grotesque that takes heavy negative tracking
 *  without falling apart — and ships Cyrillic, which the product needs and
 *  Space Mono has never had. Mono stays on for eyebrows, labels and figures, so
 *  the landing still sounds like the app it leads into.
 *
 *  The Fontsource variable face is bundled locally, while the CSS variable is
 *  scoped to the landing root. No deployment depends on a Google font URL. */

export default function LandingPage() {
  // Rendered on the server so the client shell has no Date() on its render
  // path — a year that ticks over between SSR and hydration is a mismatch.
  return <LandingShell year={new Date().getFullYear()} />;
}
