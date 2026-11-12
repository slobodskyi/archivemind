# 0054. Fullscreen photo viewer

Date: 2026-11-12

Status: Accepted

## Context

Nothing in the app showed a whole photo larger than a tile. The drawer's preview
is a fixed 220 px box with `background-size: cover`, so any frame that is not
roughly 1.7:1 loses part of itself, and there was no way to look at detail — a
face in a crowd, a sign, focus on the eyes. Every archive tool the people using
this one come from (Lightroom, Photo Mechanic, Apple Photos, Bridge) has a
fullscreen loupe, and its absence read as "the app cannot show me my own photo".

Two facts shaped the answer:

1. **The double-click is taken.** It opens the drawer on a tile, on a folder
   item and from the source sidebar, and on touch it is a hand-rolled double-tap
   (`useWorkspace`, `DOUBLE_TAP_MS`) because the canvas `preventDefault`s every
   pointerdown. Moving it would change three surfaces and one learned habit.
2. **The largest image the system holds is the 1024 px medium preview**
   (`PREVIEW_SIZES`, webp q82). No signed-in route hands a browser an original —
   they leave only through an export job or a project share link. On a retina
   laptop the medium is already upscaled ~2.5× at "fit", and soft once zoomed.

## Decision

**An overlay, not a fifth view.** `components/viewer/PhotoViewer.tsx` is a
`position: fixed` layer at the new `Z.viewer = 65` — over every piece of
workspace chrome, under modals (70) and toasts (80), so Download opens its
dialog over the viewer and a delete's undo toast is visible from inside it. It
changes nothing about the canvas under it.

**Three doors, double-click untouched.** The drawer's preview itself (plus an
expand button in its free top-left corner), the `F` key on a selection or an
open drawer, and **Open full screen** at the top of the right-click menu, under
the colour swatches — offered wherever Download is, because looking changes
nothing.

**It walks what the canvas shows, in the order it shows it.** `navOrder` in
`useWorkspace` is the current view's `readingOrder` over
`visibleTilePositions(activeTilePositions(s))` — the label filter and an open
Workspace both respected; on the Map, which has no tile geometry, the filtered
set newest-first. Opened on one of two or more selected photos, it walks just
the selection (compare a burst). The sequence is a **snapshot taken on open**
(`viewerIds`), so a photo re-labelled under an active filter does not vanish
from under the viewer. The drawer's own ←/→ moved onto the same `navOrder`: it
used to walk `s.photos` newest-first, stepping onto photos the canvas was
hiding, and the two arrows would otherwise have disagreed about "next".

**It is a culling surface too.** While it is open the viewer owns the keyboard
(the workspace handler returns early on `viewerId`): ←/→ step, `1`–`7`/`0`
label the photo on screen through the same `applyLabel` the canvas digits use,
`Delete` trashes it with the usual undo toast and steps on, `I` hands over to
the drawer on the same photo, `+`/`−` zoom, `F` browser fullscreen, `Esc`
closes. Held keys repeat only for stepping and zooming — a held Delete must not
walk through the archive. Closing selects the last photo viewed, unless you were
walking a selection, which is kept whole.

**Geometry is pure and tested; writes skip React.** `lib/viewer.ts` holds fit
(contain inside insets that keep the top bar off a fitted photo), clamp (a
zoomed photo's edge can never come inside the stage), zoom-at-point, the
fit ⇄ detail toggle, resize and the sequence rules; `components/viewer/
usePanZoom.ts` is only event plumbing and writes `left/top/width/height` on the
image box directly — not `transform: scale`, which Chrome rasterises once and
then blurs. Pinch reuses `solvePinch` (lib/pinch.ts) unchanged: its camera model
is the same one. "100%" means one loaded pixel per **device** pixel, the way
Lightroom means it on a retina screen, so a 1024 px preview honestly reads past
100% at fit.

**Progressive sources.** The thumb (already in the browser cache from the tile)
paints at once, the medium fades in over it, and the neighbours either side are
warmed once the current medium is on its way. Medium URLs come from one tab-wide
cache (`lib/preview-url-cache.ts`) that the drawer now shares — in-flight dedup,
a 20-minute TTL inside the route's 30-minute signing bucket, keyed on the
thumb's object path so an edit (ADR 0030 moves it to `edits/`) is a new entry.
A chip says which image is on screen (`PREVIEW 1024×683`, `EDITED · PREVIEW`).

**Originals are the next step, and are scoped now.** Sharpness for detail work
needs the original. The contract, landing as its own PR because it is the only
part that adds a security surface:

- `GET /api/assets/[id]/original` → `{ url, mime, bytes }` or
  `{ url: null, reason: "not_stored" | "format" }`; 401 without a session, the
  id validated as a uuid;
- `files` read under RLS (`files_select = is_member` — the same reach the ZIP
  export of originals already has), `r2_key is not null`, the asset not deleted,
  and the key must sit under `{workspace_id}/originals/`;
- an allow-list of mimes a browser can decode (jpeg, png, webp, gif, avif,
  heic/heif with a silent fallback where it cannot);
- signed **inline** (no filename, so no attachment disposition) in the same
  30-minute bucket as the medium, so returning to a photo is a browser cache hit;
- loaded after a short dwell on desktop, only on the first zoom on touch (iPad
  memory), and only on request above ~40 MiB; one original alive at a time.

Drive and OneDrive files (no original in R2), RAW and TIFF stay at 1024 px, and
the chip says so. A 2048 px preview tier — which would sharpen exactly those —
is a worker + backfill change and a later decision.

## Consequences

- The cropped drawer preview is no longer the only big view of a photo, and it
  stays a recogniser by design: the whole preview is the door to the viewer.
- Until originals land, zooming past fit shows the 1024 px medium enlarged. The
  chip and the percentage make that visible rather than pretending.
- Session replay (ADR 0050): the viewer uses `<img alt="">` with URLs only in
  `src`, which `maskAttributeFn` already rewrites; `data-ph-unmask` sits only on
  the static button cluster and the counter, never on the filename. An original
  will record as blank, by design — `/api/replay-image` refuses non-preview keys.
- The drawer's arrows now follow the visible reading order instead of every
  photo newest-first. That is a behaviour change, and the intended one.
- Browser fullscreen is requested on the **document**, not the overlay: a
  fullscreen element hides everything outside it, including Download's dialog
  and the undo toast. iPhone Safari has no element fullscreen; the button is
  simply absent there.
- Not verified on a real device: pinch, swipe and double-tap were exercised
  with synthetic pointer events in a harness, the geometry by unit tests.

## Amendments

### 2026-11-12 — originals shipped

The route scoped above is live: `app/api/assets/[id]/original/route.ts`, with
the rules both sides share in `lib/viewer-originals.ts`. What shipped, and
where it is sharper than the scope:

- **The route** answers `{ url, mime, bytes }` or `{ url: null, reason }`:
  - it returns 404 for a malformed id, an asset RLS hides, and a trashed or
    purged one, and 401 when signed out. Every response is
    `Cache-Control: private, no-store`;
  - the file it picks is the oldest `files` row with an `r2_key`, which is the
    ZIP export's own order (`loadByteRows`), so the viewer and a download never
    disagree about which file is "the original";
  - a key outside `{files.workspace_id}/originals/` answers `not_stored`, so no
    row can point it at a preview, an export or another workspace;
  - a format no browser draws answers `format` and is never signed. That covers
    TIFF, RAW, PDF, and also SVG and HTML, because the URL is inline.
- **The format is read from the key's extension** when the client declared
  nothing or `application/octet-stream`. `files.mime_type` is never sniffed,
  and the key carries the original filename. A declared, specific type wins:
  a file declared `image/tiff` and named `.jpg` is TIFF.
- **When the viewer asks:**
  - on a desktop, after a 350 ms dwell, so arrowing through a burst pulls no
    originals;
  - on touch, at the first zoom only;
  - on an edited photo, only when its **Original** toggle is pressed. The edit
    exists only as 1024 px previews, and swapping in the unedited original
    unasked would quietly undo it on screen.
- **When the viewer loads:** automatically up to 40 MiB, and a size nobody
  recorded counts as over. Anything over waits behind an `Original · 62 MB`
  button.
- **HEIC is fetched only where it can be drawn**: Safari, and every browser on
  iOS. Desktop Chrome, Firefox and Edge would download the bytes only to fail.
  A decode that fails anyway falls back to the preview, and the chip says why.
- **One original is alive at a time.** It is keyed per photo, so stepping away
  unmounts it. The answer, a bare URL or a reason, sits in the same tab-wide
  cache as the medium (`originalUrls`, version `""`), because an original does
  not change when an edit lands.
- **The chip** reads `Original 3000×2000`, `Original · unedited …`, or
  `Preview … · no original` / `· original not viewable`, and its tooltip
  carries the reason. "100%" is now measured against the original's own pixels.

Not verified: a real iPad decoding a 48 MP original. The 40 MiB cap and the
touch-only-on-zoom rule are the guard. The first device run is the test.
