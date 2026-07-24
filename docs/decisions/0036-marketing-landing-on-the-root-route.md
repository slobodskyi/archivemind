# 0036. Marketing landing on `/`: auth fork in the page, CSS Module, no-library scroll motion

Date: 2026-07-25

Status: Accepted

## Context

Everything behind `proxy.ts` assumed a signed-in caller: an anonymous visitor to
`https://www.archivemind.media` was bounced straight to `/login`, which is a
sign-in form for a product they've never seen. There was no page that explains
what ArchiveMind is.

The brief was explicit about the reference: take frame.io's *feel* — the dark
cinematic register, sticky scroll storytelling, oversized tight-tracked display
type — and put ArchiveMind on it. Reading frame.io's shipped page showed what
that feel is actually made of: no GSAP or Framer Motion in the global scope, a
procedural `<canvas>` gradient in the hero, `position: sticky` sections driven by
scroll progress, image-sequence scrubbing over a pinned canvas, and content
below the fold that doesn't render until it enters the viewport. The heavy
lifting is done by scroll position and 225 CSS custom properties, not by a
motion library.

Three constraints of this repo shaped the rest:

- **`globals.css` sets `body { overflow: hidden }`** — correct for an app whose
  main surface is a fixed infinite canvas, fatal for a page that scrolls.
- **ADR 0001 mandates inline styles** for ported canvas UI, to pin it to the
  source design pixel-for-pixel.
- **No `Math.random` on layout or render paths** (reproducibility), which also
  happens to be the rule that keeps SSR and hydration agreeing.

We have no product footage. frame.io fills its hero and its scrub section with
4K video; copying the *structure* while having nothing to put in it would have
produced an empty stage.

## Decision

**1. `/` serves both audiences; the page decides, not the router.** `proxy.ts`
adds an exact-match exemption for `/` (not a prefix — `/projects/*` stays
guarded), and `app/page.tsx` forks: `getClaims()` returns nothing → render
`<LandingPage />`; claims but no user → `/auth/reset` as before; otherwise the
existing `HomeClient` hub. No new URL, no redirect, and every existing link to
`/` keeps its meaning for signed-in users.

Rejected: a `(marketing)` route group with the landing at `/` and the hub moved
to `/home`. It reads cleaner in the file tree but changes the URL every existing
session, bookmark and redirect target already points at.

**2. The landing brings its own scroll container.** `.root` is
`position: fixed; inset: 0; overflow-y: auto`, so `body { overflow: hidden }`
stays untouched and `position: sticky` resolves against that element. The
consequence to remember: **scroll events never reach `window`** — `ScrubDemo`
listens on `document` in the capture phase instead.

**3. Styles are a CSS Module, not inline styles.** ADR 0001's reason (pixel
fidelity to a ported design) doesn't apply to a page designed here, and inline
styles can express neither `:hover`, `@media`, `@keyframes`, nor the
`prefers-reduced-motion` fallbacks this surface is built out of. The module hash
scopes it, so nothing can leak into the workspace.

**4. Motion is hand-rolled; no library was added.** A `<canvas>` hero gradient
(four blobs on fixed sine paths, painted at 72×40 and upscaled — the upscale is
the blur), `IntersectionObserver` for reveal-on-enter and for the Prompter's
centre-band step tracking, and one sticky 360vh section whose scroll progress
morphs tiles between three layouts. Per-frame updates are written straight to
`element.style.transform`; only the active step (which changes twice) goes
through React state.

**5. The scrub demo replaces the video we don't have.** The same 34 tiles move
through the product's three real views — canvas grid → semantic clusters → map
pins — with positions from a seeded `mulberry32`, never `Math.random`. It
demonstrates the product instead of showing a picture of it, and it costs no
asset pipeline.

**6. Display type is Inter Tight, loaded only here.** Space Mono is right for a
workspace and wrong for a headline, and it has never had Cyrillic. Inter Tight
takes the heavy negative tracking (-0.045em) the reference register depends on
and ships Cyrillic; `next/font` scopes it to this subtree, so the workspace
bundle doesn't pay for it. Mono stays on for eyebrows, labels and figures — the
landing still sounds like the app it leads into.

**7. Nothing is borrowed except the vocabulary.** No frame.io assets, fonts,
copy or marks. Their licensed faces (FrameGothic, NeueMachinaInktrap) are not
used. Every claim on the page maps to shipped behaviour — "0 AI calls you didn't
ask for" is ADR 0028's rule, "30 days" is ADR 0033's window, "768" is the
embedding width — because the alternative is inventing benchmarks, and frame.io's
own numbers are attributed to studies we haven't run.

## Consequences

- **`/` stays dynamic.** The auth fork reads cookies, so the landing is rendered
  per request rather than served as static HTML. Acceptable for a page this
  light; if it ever needs edge caching, that's the point to reconsider the
  route-group split rejected above.
- **Hero and preview entrances are CSS animations from `opacity: 0`.** In a
  background tab the browser freezes them, so the headline is blank until the
  visitor looks at it — standard behaviour for fade-in landings, and the text is
  in the DOM for crawlers and screen readers throughout. If that ever becomes a
  real complaint, gate the animation on a JS-set class instead.
- **A second styling convention now exists in `apps/web`.** CSS Modules for
  marketing surfaces, inline styles for ported canvas UI. Keep the boundary at
  `components/landing/`.
- **The scrub section is 360vh tall.** Sticky releases before the section ends
  is impossible by construction, but anyone changing that height must keep
  `travel = height - viewport` in mind — that's what the progress calculation
  divides by.
