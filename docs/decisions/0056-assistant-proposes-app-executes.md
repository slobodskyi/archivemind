# 0056. The assistant proposes, the app executes

Date: 2026-11-12

Status: Accepted

## Context

The chat panel was Smart Search and nothing else (#16, ADR 0029/0031): every
message went to `GET /api/search`, and the answer was a sentence, a strip of
thumbs and one button, **Select N on canvas**. Two things followed from that.

1. **A search that found nothing answered with an instruction.** Search only
   sees analyzed photos, so the commonest reason for zero matches is an
   unanalyzed pile. The reply said "click the ✨ badge on a photo to analyze
   it". The server could not tell "nothing analyzed" from "analyzed, no match"
   (`search_assets` iterates `embeddings`, so an unanalyzed asset is simply
   absent), and the chat had no way to start the analysis it was recommending.
2. **An answer was a dead end.** Having found twelve photos, the only thing to
   do was select them and go and find the control for whatever came next. Every
   one of those controls exists — add to a Workspace, colour label, Share,
   Download, captions, the viewer, Trash — and none was reachable from the
   place the photos had just been found.

Making the chat able to *do* things raises the question an assistant always
raises: what is it allowed to do on its own. Three rules already in the app
bear on the answer. AI runs only by an explicit button, with the credits shown
first (ADR 0028, 0037). What you cannot see you cannot act on (ADR 0040). And
the canvas menu already encodes where each action exists at all — no
Workspaces, Share or Trash on the `all` canvas.

## Decision

**The assistant proposes; the app executes.** The chat never writes anything
itself. It produces *descriptions* — a `ChatAction` (`types/chat.ts`) — and one
dispatcher, `runAction` in `hooks/useAssistant.ts`, maps each onto the handler
a button somewhere already calls: `useBoards` for Workspaces, `openShare` and
`openExportFor` for the two dialogs, `openBulkFor` for the AI panel,
`applyLabel` for labels, the Trash confirm. There is no new route and no new
write path, so whatever those handlers enforce — the single-job lock, RLS on
the route, the Share dialog's own scoping — the assistant inherits by
construction rather than by re-implementation.

**One execution rule, by what an action costs to get wrong:**

| Class | Actions | How it runs |
|---|---|---|
| Reversible and free | select, full screen, add to a Workspace, colour label, label filter, switch view, open a Workspace | At once, behind the Undo its handler already offers |
| Spends credits | analyze, captions | Opens `BulkAiPanel` on those photos — count, operations and credit estimate visible, nothing runs until **Run** |
| Leaves the app | Share, Download | Opens `ShareDialog` / `ExportDialog` on those photos; the dialog is the decision |
| Destructive | Move to Trash | Always `ConfirmModal`, at any count — then the usual Undo toast |

The Trash row is stricter than the canvas on purpose. `requestDeletePhotos`
lets fewer than eight files go straight to the Undo toast, because a click on a
tile is a click on the photo. A chat button is one step further from the
photos than that, so `confirmDelete` asks whatever the count.

**An action reaches only the photos this canvas draws.** A search answer can
name a photo the open Workspace or the label filter is hiding, one in another
project, or one beyond the loaded window. `resultActions` (`lib/assistant.ts`)
narrows a result set to the drawn ids, and the row says how many it left out
("2 more are outside this view"). One action reaches past that, because it is
the only way to make those photos drawable: inside an open Workspace, loaded
results that are not members get **Add N to {workspace}**.

`selectSearchResults` used to test against every *loaded* photo, so the chat's
own Select picked tiles nobody could see. The assistant now calls `selectIds`,
which tests against `navOrder` — the reading order over the tiles actually
drawn. The old function stays for its two other callers (the Map's cluster
select and a share link's "Show on canvas"), whose ids are about to be shown.

**The gates are the canvas menu's, restated once.** `resultActions` and
`runAction` both refuse Workspaces, Share and Trash outside a project, and view
switching wherever the switcher is hidden. A chip is never offered for
something the menu would refuse.

**Offers are computed from the canvas, not asked of the server.** "Analyze N
photos…" uses `unanalyzedInScope` — the function the AI panel's own intro
uses — so N is exactly what the button selects: ready, drawn, not already in a
running job. The reply that used to give an instruction now reads "No matches.
80 of 120 photos on this canvas aren't analyzed yet, so search can't see them."
with that button under it. When the search did find something, the same fact
is small print under the results rather than part of the answer.

The follow-up is tied to the outcome, not to the click. "Analyze N" only opens
a panel the user may still close; the chat says "Analysis finished" when a job
has run *and* some of the offered photos come back analyzed, and says nothing
otherwise.

**Starter suggestions come from the archive.** The four fixed English examples
("medical workers", "flooded streets", …) matched nothing in most archives.
`starterSuggestions` offers the archive's own most common tags — dropping the
near-universal ones, which find everything and show nothing — plus the analyze
offer and, when it would narrow something, the untriaged pile.

**The conversation left `useWorkspace`.** Messages, input and `send` live in
`useAssistant`, called from `ArchiveWorkspace`, because that is where the three
owners it drives are all in reach (`ws`, `useBoards`, and the component's own
Share and AI-panel closures). Only `chatOpen` stays in `useWorkspace`: layout
and Escape read it. What decides *which* actions exist for a set of results is
`lib/assistant.ts` — pure, no clock, no random, unit-tested without a DOM.

## Consequences

- The chat adds no capability the app did not have, so it adds no permission
  question either. A new assistant action is a new `ChatAction` member plus one
  `runAction` arm pointing at an existing handler; if no handler exists, the
  feature is missing from the app, not from the chat.
- Every count in a reply is over what the canvas draws. Inside a Workspace, or
  with more photos than the loaded window, "N aren't analyzed yet" under-reports
  what search actually skipped. That is the honest number for the button beside
  it — N is what **Analyze N** selects — and the alternative, a server count the
  button cannot act on, is how a label ends up promising work that will not run.
- Re-cluster and renaming the seven label names are deliberately **not**
  assistant actions: both have no UI entry point on purpose (ADR 0038, 0040),
  and the assistant is a UI entry point.
- The conversation is still in memory and still English, like the rest of the
  UI. Typed commands ("add these to Wedding") change none of the above: a
  parsed intent becomes a `ChatAction` and takes the same road — see the
  amendment below.

## Amendments

### 2026-11-12 — typed commands

The chat now understands commands as well as searches. Nothing in the Decision
moves; this adds the step in front of it.

**The model names an intent and does nothing else.** `POST /api/assistant`
makes the one model call `GET /api/search` already made — the query parse —
with an intent attached (`assistantIntentSchema` in `packages/shared`): an
`action` out of a closed list, a `target` (the last answer, the selection, the
unanalyzed pile, everything, or "the photos this message describes"), and at
most a Workspace name, a colour and a view. The route contains no write. Its
answer goes to `resolveIntent` (`lib/assistant-intent.ts`, pure), which turns
it into a `ChatAction` over real ids, a question, or a refusal — against the
same snapshot and the same gates as the buttons.

**An action runs only over photos the user has already seen.** "Add these to
Wedding" after an answer runs. "Add the dog photos to Pets" does not: the
search runs, the results are shown, and the action is the first button under
them, because nobody has looked at that set yet. This is the whole of the
auto-run rule, and it holds for every action alike — including Trash, which on
a fresh search is an offered button and, once clicked, still a confirm.
"Runs" keeps the meaning the table above gives it: a credit-spending command
opens the AI panel, Share and Download open their dialogs, Trash asks.

**No guessing.** Every intent field is `.catch()`-guarded, so an answer the
parser cannot classify is a search — what every message was before. A Workspace
name matches exactly, else by the only prefix, else by the only fragment; two
candidates is no match and the assistant asks. A name that matches nothing
offers `Create “X” with these N`; it is never created unasked. A missing colour
or Workspace is a question with the choices as buttons.

**What a manipulated intent can do.** The message and the Workspace names are
user text and go to the model as content, JSON-quoted, with the instructions
in the system slot. Suppose they steer it anyway: the worst a wrong intent can
do is what a wrong click can do. It picks from a closed enum; it cannot name an
asset id; reversible actions carry their Undo; and everything else stops at a
panel or a dialog that states the count. That is the reason the model was kept
on the proposing side of the line rather than given tools.

**Cost.** One model call per message, as before, and the embedding plus
`search_assets()` only when the intent needs a search
(`assistantNeedsSearch`) — so a command is cheaper than the search every
message used to be. Zero credits either way. A search logs its `search_query`
usage event exactly as it did; a pure command logs nothing, because there is no
event type for it and counting it as a search would inflate that number. The
parse call of a command is therefore the one model cost `usage_events` does
not see.

**Not done, on purpose.** No multi-step tool loop: one message, one intent. The
model sees no conversation history — only whether results are shown and how
many photos are selected — so "the second one" or "not those" mean nothing to
it. `GET /api/search` stays as the spec §8.4 search endpoint and shares the
pipeline in `lib/search-server.ts`, but the chat was its only caller: since
this amendment nothing in the UI calls it.
