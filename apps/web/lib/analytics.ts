import type { PostHogConfig } from "posthog-js";

/** PostHog product analytics + session replay (ADR 0050).
 *
 *  This file is the whole privacy contract, kept pure so it can be tested
 *  without a browser. A recording is a copy of the DOM, so everything on
 *  screen would leave the building unless a rule here stops it:
 *
 *  - **Text is masked by default.** Captions, facts, filenames, note bodies,
 *    project and workspace names are all user content, and they render inside
 *    buttons as often as outside them, so "buttons stay readable" leaks. A
 *    container opts its text back in with `data-ph-unmask`, and only a surface
 *    that prints product copy alone may carry it; `data-ph-mask` re-masks a
 *    subtree inside one. The NEAREST marker wins.
 *  - **Presigned R2 URLs never reach PostHog.** Photos render as inline
 *    `background-image: url(<presigned>)`, not `<img>`, so blocking images
 *    would miss them. A presigned URL is a bearer credential — ADR 0035 took
 *    them out of `ai_jobs.payload` for exactly this — so every attribute
 *    (`style`, `src`, `href`) and every recorded network request is scrubbed.
 *  - **Signed-in only.** Nothing initialises PostHog before a signed-in page
 *    mounts `PostHogSession`, so the landing, login and `/p/*` share pages
 *    (whose URL is itself a bearer token) never load it. */

export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";

/** Same-origin reverse proxy (next.config.ts rewrites). Keeps ad blockers from
 *  silently dropping recordings and keeps PostHog's host out of the page. */
export const POSTHOG_API_HOST = "/ingest";
/** EU Cloud: the database is EU-only, and recordings are screens of it. */
export const POSTHOG_UI_HOST = "https://eu.posthog.com";

export const UNMASK_ATTR = "data-ph-unmask";
export const MASK_ATTR = "data-ph-mask";

/** What a redacted URL becomes: a valid, empty data URI, so the replay player
 *  neither requests anything nor resolves it against PostHog's own origin. */
export const REDACTED_URL = "data:,";

// A URL whose query carries an AWS SigV4 signature — what @aws-sdk's presigner
// emits for R2. Stops at the characters that end a URL inside a CSS url() or
// an attribute: whitespace, quotes and parentheses.
const SIGNED_URL = /https?:\/\/[^\s"'()]+?\?[^\s"'()]*X-Amz-[^\s"'()]*/g;

/** Replace every presigned URL inside `value` (a whole attribute, or a full
 *  `style` string with several `url()`s) with `REDACTED_URL`. */
export function redactSignedUrls(value: string): string {
  return value.replace(SIGNED_URL, REDACTED_URL);
}

/** The slice of `Element` the masking rule needs — lets tests pass a stub. */
type Closest = Pick<Element, "closest" | "hasAttribute">;

/** Whether text under `el` may be recorded as-is: only when its nearest
 *  marker is `data-ph-unmask`. No marker at all → masked. */
export function isUnmasked(el: Closest | null | undefined): boolean {
  const marked = el?.closest(`[${UNMASK_ATTR}],[${MASK_ATTR}]`);
  return !!marked && marked.hasAttribute(UNMASK_ATTR) && !marked.hasAttribute(MASK_ATTR);
}

function stars(text: string): string {
  return text.replace(/\S/g, "*");
}

export function maskText(text: string, el?: Closest | null): string {
  return isUnmasked(el) ? text : stars(text);
}

// Attributes that carry human-readable text: a filename in a `title`, a
// caption in an `alt`. They follow the same rule as the text they describe.
const TEXT_ATTRS = new Set(["title", "alt", "aria-label", "placeholder"]);

export function maskAttribute(name: string, value: string, el?: Closest | null): string {
  const scrubbed = redactSignedUrls(value);
  return TEXT_ATTRS.has(name) ? maskText(scrubbed, el) : scrubbed;
}

/** The init options. `defaults` pins PostHog's behaviour set, so a library
 *  bump cannot change what is captured without this date changing too. */
export function posthogConfig(): Partial<PostHogConfig> {
  return {
    api_host: POSTHOG_API_HOST,
    ui_host: POSTHOG_UI_HOST,
    defaults: "2026-08-30",
    // Every page we load on is signed in and immediately identified.
    person_profiles: "identified_only",
    // App Router navigations are history changes, not page loads.
    capture_pageview: "history_change",
    capture_pageleave: true,
    // Autocapture records the clicked element's TEXT as an event property,
    // outside the replay's masking — a click on a tile would ship its
    // filename. The replay already carries every click.
    autocapture: false,
    disable_surveys: true,
    capture_exceptions: false,
    enable_heatmaps: false,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
      maskTextFn: (text, el) => maskText(text, el),
      maskAttributeFn: (name, value, el) => maskAttribute(name, value, el),
      // Request headers/bodies stay out even if the project setting turns
      // network capture on; the URL list itself is scrubbed of signatures.
      recordHeaders: false,
      recordBody: false,
      maskCapturedNetworkRequestFn: (req) => ({ ...req, name: redactSignedUrls(req.name) }),
    },
  };
}
