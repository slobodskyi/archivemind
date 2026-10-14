# 0050. PostHog session replay: signed-in only, private by default

Date: 2026-10-14

Status: Accepted

## Context

We have no view of how people actually use the canvas. Bugs arrive as "the tile
jumped" with no way to see what was clicked before it, and the mobile work
(#211, #248) shipped without ever being watched on a real device. Session
replay answers both. PostHog was chosen for it: replay, product analytics and an
EU region in one SDK.

A recording is a copy of the DOM, so the question is not whether replay works
but what it would carry out of the building:

- **Photos.** Every tile, drawer preview, trash thumb and bulk-AI strip renders
  as an inline `background-image: url(<presigned R2 URL>)`, not an `<img>`. A
  presigned URL is a bearer credential: ADR 0035 removed them from
  `ai_jobs.payload` because a URL parked there leaked to every member. In a
  recording it would sit at a third party for the retention period, and the
  replay player would fetch the photo for whoever watched while it was valid.
  Blocking `<img>` (the textbook setting) would have caught almost none of them.
- **Text.** Captions, facts, filenames, EXIF place names, note bodies, search
  results, project, workspace, folder and draft names. Many of them render
  inside `<button>`s (a workspace chip, a draft card, a OneDrive row, a trash
  row), so "mask content, keep buttons readable" leaks by construction.
- **Addresses.** `/p/{token}` is a bearer link (ADR 0046). The address IS the
  credential.
- **Consent.** EU visitors on the public landing would need a consent banner
  and a privacy policy before anything non-essential is recorded. We have
  neither yet.

## Decision

1. **Signed-in only.** PostHog is never initialised by a page load. The client
   component `PostHogSession` is mounted by the three signed-in pages (`/`
   signed-in fork, `/projects/[id]`, `/account/usage`) and imports `posthog-js`
   on demand from there. The landing, `/login`, `/signup` and `/p/*` never
   download the SDK. Consent for anonymous visitors is deferred until there is a
   privacy policy to consent to.
2. **Identity: Supabase user id + email.** `identify(user.id, { email })`, so a
   recording can be matched to a person from a support message.
   `person_profiles: 'identified_only'`. Both sign-out paths call `reset()`, and
   a different identified id on the same browser resets before identifying, so
   two people are never stitched into one person.
3. **Text is masked by default** (`maskTextSelector: '*'`). A container opts its
   text back in with `data-ph-unmask`, and may only do so if it prints product
   copy alone; `data-ph-mask` re-masks a subtree inside one. The nearest marker
   wins. Shipped unmasked: `LeftToolbar`, `ViewSwitcher`, `WorkspaceActionBar`,
   `SortingActionBar` (with `TopicMembershipMenu` re-masked: its targets are
   cloud names). `title`, `alt`, `aria-label` and `placeholder` follow the same
   rule as text. Inputs are always masked.
4. **Presigned URLs are scrubbed from every attribute** (`maskAttributeFn`, which
   also forces the recorder to send full `style` strings rather than style
   diffs, so the scrub sees each `url()`), and from recorded network request
   names. Request headers and bodies are never recorded.
5. **Autocapture is off.** It records a clicked element's text as an event
   property, outside the replay's masking; a click on a tile would ship its
   filename. The replay already carries every click. Pageviews (`history_change`)
   and pageleave stay on.
6. **EU Cloud through a same-origin proxy.** `next.config.ts` rewrites
   `/ingest/*` to `eu.i.posthog.com` / `eu-assets.i.posthog.com`, so ad blockers
   cannot silently drop recordings. `proxy.ts` excludes `ingest/` from its
   matcher: Next runs the proxy *before* rewrites, so otherwise every upload
   would pay a Supabase session check.
7. **Env-gated.** No `NEXT_PUBLIC_POSTHOG_KEY` means no SDK load at all: local
   dev, tests and any preview without the variable record nothing.

The whole contract lives in `apps/web/lib/analytics.ts`, kept pure and covered
by `lib/analytics.test.ts`.

## Consequences

- Replays show layout, movement, clicks and the toolbars' labels; content reads as
  asterisks and photos as empty tiles. Making another surface readable is a
  one-attribute change, and the reviewer's question is always the same: can this
  container ever print something a user typed or uploaded?
- A new surface is private until someone opts it in. That is the point: the
  failure mode of forgetting is an unreadable replay, not a leak.
- The Map's WebGL canvas is not recorded (canvas capture is off), so the map
  background is empty in replays. Its markers are DOM and replay normally,
  minus their photos.
- `maskAttributeFn` disables the recorder's style-diff compression, and pan/zoom
  rewrites the canvas transform every frame. Recording size and jank on a large
  project must be measured before relying on it on phones; PostHog's mutation
  throttle is the lever if needed.
- Anonymous funnels (landing → signup) are not measured. That needs consent
  first, and is a separate decision.
- PostHog project settings (replay on, authorized domain, retention, the DPA)
  live in the PostHog dashboard, not in this repo.

## Amendments

### 2026-10-14 — console logs are off in code, not in the dashboard

The live project's remote config came back with console-log recording **on**
(PostHog's default for a new project). Console output replays as plain text,
outside the DOM masking, and the app's error paths print what a request was
about. `enable_recording_console_log: false` now sits in `posthogConfig()`. The
client value wins over the project setting, the same precedence PostHog
documents for masking, so turning the toggle back on in the dashboard cannot
re-enable it. The same check confirmed that the client masking config
(`maskAllInputs: true`, `maskTextSelector: '*'`) already overrides the
dashboard's `maskAllInputs: false`.

