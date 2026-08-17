# 0047. OneDrive integration — Day-0 spike findings

Date: 2026-08-17

Status: Proposed

> **Numbering note.** The implementation brief asks for this to land as
> `ADR-0012-onedrive-integration.md`. **0012 is taken** —
> `0012-toolbar-header-reorg.md`, merged long ago — and ADR numbers here are
> append-only identifiers, not slots to be reused. This is 0047, the next free
> number. Nothing else about the brief's intent changes.

## Context

We want a user to connect a Microsoft account and import photo/PDF archives
from OneDrive, on the same **snapshot import** model as Google Drive (ADR 0025)
and Dropbox (ADR 0008).

The headline capability is **folder-tree import**. Drive's `drive.file` scope
cannot expand a picked folder into its children, so Drive import makes the user
multi-select individual files. OneDrive under delegated `Files.Read` can walk
the tree. If the shipped feature still requires picking 10,000 files by hand,
it has missed the point.

The brief lists six unknowns (S1–S6) that "may not be guessed". This ADR records
what the documentation answers, what still needs a live account, and — separately
— **where the brief's assumptions about our own codebase are wrong**. The second
list is the more urgent one: four of those errors would have produced code that
compiles and silently writes nothing.

No production code has been written. No migration has been authored. The Azure
app registration (§3 of the brief) has **not** been done — it is a human task,
and every "needs a live test" below is blocked on it.

## Decision

Record the findings (Parts 1–2), and scope the MVP around them (Part 3).

The shape of the MVP is one call and four consequences: **do not ship the v8
picker.** Browse the drive through Graph with our own UI. That single choice
deletes the largest unknown (S2), the largest piece of hand-rolled protocol
(§7.3), and the whole personal-vs-business divergence — while delivering §1's
folder-tree import in full.

---

### Part 1 — The six spike questions

All URLs consulted **2026-08-17**.

#### S1 — Picker v8 host URL per account type — **ANSWERED (docs)**

The picker is a Microsoft-hosted page you POST a form to and drive over
`postMessage`. There is no JS SDK. The endpoint is
`{baseUrl}/_layouts/15/FilePicker.aspx?filePicker={json}&locale={lcid}`, POSTed
with the access token in a hidden `access_token` input (optional for a popup,
**required for an iframe**).

| Account type | `baseUrl` | Authority |
| --- | --- | --- |
| Personal (MSA) | `https://onedrive.live.com/picker` | `https://login.microsoftonline.com/consumers` |
| Business / SharePoint | `https://{tenant}-my.sharepoint.com` | tenant authority |

**The consequence the brief does not anticipate:** the personal base URL is a
constant, the business one is **not**. It is derived per connection from the
user's own tenant. That must be resolved at connect time (from `GET /me/drive`
→ `webUrl`) and stored — this is the strongest single argument for the brief's
own `provider_metadata` jsonb column, and it means the personal/business split
is more than a config branch (see *Surfaced* below).

Source: [File Pickers overview](https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/)

#### S2 — Which token the picker wants — **ANSWERED (docs), and it is not one token**

Verbatim from the docs:

> Currently the control relies on SharePoint tokens and not Graph, so you will
> need to ensure your resource is correct and you cannot reuse tokens for Graph
> calls.

So the brief is right that the picker token and the Graph token are different
tokens. But the v8 schema qualifies it — `authentication.tokens` exposes
`graph`, `sharePoint` and `substrate` booleans, and **`graph` and `sharePoint`
both default to `true`**. The picker issues an `authenticate` command over the
MessagePort carrying its own `resource` and `type` fields, and the host answers
per command. The resource is therefore **told to us at runtime**, not
hardcoded — `getToken(command)` in the sample builds the scope as
`` `${command.resource}/.default` ``.

For personal accounts the docs name the token scope explicitly:

> When you request a token you will use the `OneDrive.ReadOnly` or
> `OneDrive.ReadWrite` when you request the token. When you request the
> permissions for your application you will select for `Files.Read` or
> `Files.ReadWrite`.

i.e. the *app registration* holds `Files.Read`; the *token request* names
`OneDrive.ReadOnly`. Those are not the same string and conflating them is the
day this integration eats.

**Can one server-side consent mint both tokens?** Yes — this is the pivotal
finding for §7.2, and it is documented rather than folklore. Three quotes:

- `/authorize` scope: *"For the `/authorize` leg of the request, this parameter
  **can cover multiple resources**."*
- `/token` code redemption scope: *"The scopes must all be from a **single
  resource**, along with OIDC scopes."*
- Refresh: *"**Refresh tokens are valid for all permissions that your client has
  already received consent for.** For example, a refresh token issued on a
  request for `scope=mail.read` can be used to request a new access token for
  `scope=api://contoso.com/api/UseResource`."*

So the flow is: **one** `/authorize` naming both resources → redeem the code for
a Graph token (+ refresh token) → later redeem that same refresh token with the
picker resource's scope for a picker token. **One consent prompt.** §7.2 is
feasible as specified.

One trap on that path: *"Clients can't combine static (`.default`) consent and
dynamic consent in a single request"* — `scope=https://graph.microsoft.com/.default Mail.Read`
is an error. The multi-resource authorize must therefore use dynamic scopes for
**both** resources, so we need the picker resource's fully-qualified dynamic
scope string, not its `.default`. That exact string is the one thing here still
worth a live check.

**This also vindicates the brief against the docs on SPA-vs-Web.** The docs'
"Required Setup" says to register a **Single-page application** and use
`@azure/msal-browser`. Do not follow that. Per the auth-code-flow reference:
*"For refresh tokens sent to a redirect URI registered as `spa`, the refresh
token expires after 24 hours."* A worker that re-reads bytes tomorrow cannot
live on a 24-hour refresh token. The brief's "Web platform, not SPA" (§3) is
correct and load-bearing — keep it, and ignore the docs' setup steps on this
point.

Sources: [File Pickers overview](https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/) ·
[v8 schema](https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/v8-schema?view=odsp-graph-online) ·
[Auth code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow) ·
[Scopes and permissions](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc)

#### S3 — Does `Files.Read` suffice for recursive listing? — **ANSWERED: YES**

`GET /me/drive/items/{item-id}/children` permissions table:

| Permission type | Least privileged | Higher privileged |
| --- | --- | --- |
| Delegated (work or school) | **`Files.Read`** | `Files.ReadWrite`, `Files.Read.All`, … |
| Delegated (personal MSA) | **`Files.Read`** | `Files.ReadWrite`, `Files.Read.All`, … |

`Files.Read` is the *least privileged* permission for the call, on both account
types. **The §1 value proposition holds and C4 stands** — no `.All` needed.

Paging: default page size **200 items**, `@odata.nextLink` when exceeded.
`$select`, `$top`, `$skipToken`, `$orderby`, `$expand` all supported.

(Note the picker's own "Required Setup" tells you to add `Files.Read.All`,
`Sites.Read.All`, `AllSites.Read`, `MyFiles.Read`. That is the maximal
SharePoint-and-Teams configuration. For our OneDrive-only, read-only case the
Permissions table on the same page reduces it to SharePoint `MyFiles.Read` **or**
Graph `Files.Read`. C4 survives — but the picker's SharePoint-resource token is
a separate consent surface from Graph's, so confirm the minimal working pair
live.)

Source: [List children](https://learn.microsoft.com/en-us/graph/api/driveitem-list-children?view=graph-rest-1.0)

#### S4 — Photo facet coverage — **HALF ANSWERED**

The business limitation is confirmed, verbatim, and still current (page updated
2024-03-12):

> OneDrive for Business and SharePoint only return the **takenDateTime**
> property.

Full personal-account facet: `cameraMake`, `cameraModel`, `exposureDenominator`,
`exposureNumerator`, `fNumber`, `focalLength`, `iso`, `orientation`,
`takenDateTime`. (The brief's §4 list omits `orientation`; it is real and, for
a photo archive, the one we would actually miss.)

**Unanswered — needs real files:** whether the facets populate at all for RAW
(NEF/CR2/ARW) and HEIC. Undocumented either way. This is exactly the case where
guessing is worst, so §8.4's policy — facets are a *pre-fill*, local extraction
is the source of truth — should be adopted **regardless** of how the live test
comes out. It costs nothing when facets are rich and saves the feature when they
are empty.

Source: [photo resource](https://learn.microsoft.com/en-us/graph/api/resources/photo?view=graph-rest-1.0)

#### S5 — `@microsoft.graph.downloadUrl` behaviour — **MOSTLY ANSWERED**

- `/content` returns **`302 Found`** to a pre-authenticated URL — the same URL
  as `@microsoft.graph.downloadUrl`.
- TTL: *"Preauthenticated download URLs are valid for a limited time. Use them
  immediately, as they might expire within minutes."* Deliberately unspecified —
  treat as **minutes**, resolve per file immediately before fetching, never
  persist. (Contrast Dropbox's ~4 h links, which ADR 0008 parks in the job
  payload. **Do not copy that pattern here** — a OneDrive link will be dead
  before a queued job reaches the file.)
- Auth header: *"You don't need to include an `Authorization` header when you
  access the download URL."* The brief's stronger claim that sending one *causes
  a failure* is not in the docs; what is documented is that a 302 plus an
  `Authorization` header breaks the CORS preflight in a **browser**. Server-side
  it is merely unnecessary. Send it nowhere anyway.
- **`Range` IS supported**, appended to the `downloadUrl` itself and *not* to
  `/content` → `206 Partial Content`. If the range can't be served it is ignored
  and a `200` with the whole file comes back — so a range-based reader must
  handle getting everything.
- **Unanswered:** behaviour above 1 GB. Undocumented; needs a live test. Our
  own `MAX_IMPORT_BYTES` (200 MB) makes this mostly academic for now.

Source: [Download driveItem content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)

#### S6 — Throttling shape — **ANSWERED in shape, not in numbers**

- `429` **and `503`** both mean throttled. `Retry-After` is in seconds.
- No published numeric rate limit for this delegated path. Throttling is
  per-app-per-tenant, and *"Serving a request for one resource in a tenant will
  correspondingly give you less resources to make a call to another resource for
  that same tenant."* Peak hours throttle sooner than nights/weekends.
- *"If throttling persists, the `Retry-After` value may become longer over
  time"*, and *"Apps that do not honor the retry after duration before calling
  back will be blocked due to abusive calling patterns."*
- **The one that changes our design:** *"When waiting for 429 or 503 recovery
  you should ensure that you **pause all further requests** you are making to
  the service. This is especially important in multi-threaded scenarios."*

That last line means §9's `p-limit(4)` with per-request backoff is **not
sufficient**. A 429 on one of four in-flight requests must pause the other
three — a connection-scoped circuit breaker, not a per-request retry. Building
it as per-request backoff would actively extend our own throttling.

The empirical rate numbers the brief wants for §9 cannot be obtained without a
live account, and are per-tenant anyway. Recommendation: ship the circuit
breaker with a conservative `ONEDRIVE_CONCURRENCY=4`, log every `Retry-After`,
and tune from production telemetry rather than from a one-off measurement that
won't generalise.

Sources: [Graph throttling](https://learn.microsoft.com/en-us/graph/throttling) ·
[Scan guidance](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/scan-guidance?view=odsp-graph-online)

---

### Part 2 — Where the brief is wrong about *our* codebase

Every item verified against the tree at `e161074`. These are not style
quibbles — the first four produce code that typechecks and does nothing.

1. **`file_exif` does not exist.** The table is **`asset_exif`**, and it hangs
   off the **asset**, not the file (`supabase/migrations/20260710000001_init.sql:107`).
   §8.4's "populate `file_exif`" names neither the right table nor the right
   entity. This is the Asset ≠ File split of ADR 0011, and it is the spine of
   the schema — EXIF, previews, tags, captions and embeddings all key on
   `asset_id`. `location_source` is real and lives there.

2. **`files` has no `status` column.** §9 says a 404 should "mark
   `files.status = 'source_missing'`". `source_missing` is a value of the
   **`asset_status`** enum, on **`assets.status`**. There is no status on
   `files` at all. The intent is right and the target is wrong.

3. **`MAX_ORIGINAL_BYTES` does not exist; the guard is already there.** It is
   **`MAX_IMPORT_BYTES`**, default 200 MB
   (`apps/worker/src/handlers/ingest.ts:42`), already enforced for both Drive
   (by declared size, pre-fetch) and Dropbox (declared *and* actual). §8.5 asks
   for a guard we have; reuse it, don't add a second name for it.

4. **`importRequestSchema` is already a discriminated union on `provider`**
   (`packages/shared/src/index.ts:553`). §6 hedges — "if the current schema is
   not already shaped for this, refactor it". It is. Adding `onedrive` is a
   third arm and nothing else. The refactor is not in scope because it is not
   needed.

5. **C6 contradicts the pipeline the brief tells us to mirror.** §8.1 says
   mirror `gdrive.ts`/`dropbox.ts`; C6 says never buffer an original. Both
   existing services return **`Promise<Buffer>`**
   (`gdrive.ts:112`, `dropbox.ts:48`), and the pipeline below them is
   Buffer-shaped too — `extractExif(buf: Buffer, …)` writes the buffer to a
   temp file because `exiftool-vendored` reads paths, not streams
   (`apps/worker/src/services/exif.ts:154`). You cannot both mirror the
   existing services and never buffer. See *Surfaced* below.

6. **The `oneDrivePickedItem` schema as drafted would reject valid picker
   payloads.** §6 marks `name` (`.min(1)`) and `isFolder` required. The picker
   guarantees only:

   ```
   { "id": string, "parentReference": { "driveId": string }, "@sharePoint.endpoint": string }
   ```

   Everything else is "may be returned". Make `name`/`isFolder`/`size`/`mimeType`
   optional and resolve the truth from Graph via `driveId`+`itemId`, which we
   must call anyway for `downloadUrl`. Also capture `@sharePoint.endpoint` —
   it is guaranteed, it is how the docs tell you to build the follow-up request,
   and it is absent from the brief's schema.

7. **Enum-in-transaction gotcha: correct, and it also applies to `job_type`.**
   §5's warning is right. Worth noting the same file adds no job type — C8 says
   reuse `ingest`, which is correct and keeps the "seven handlers, one per
   member of `jobTypeSchema`" invariant intact.

8. **`progress_label` is real** (`ai_jobs`, init:217) and already drives import
   toasts in `useWorkspace.ts`. §8.2's progress plan works as written.

Also worth knowing, though not an error: `files.source_path` already exists for
provenance, so `source_drive_id` joins an existing convention rather than
starting one.

---

## Consequences

**Answered without credentials:** S1, S2, S3, S5 (bar >1 GB), S6 (shape). The
value proposition survives contact with the docs — `Files.Read` really does walk
a tree, and the picker really can return folders (`typesAndSources.mode:
"folders" | "all"`, `selection.mode: "multiple"`, `selection.maximumCount`), so
§1 is buildable and §13's two invalidating conditions did **not** fire.

**Still needs a live account** (all blocked on §3, the Azure registration):
facet coverage on RAW/HEIC; downloadUrl >1 GB; real throttling numbers. Two
further unknowns — the picker resource's exact dynamic scope string, and
whether MSA refresh tokens honour the cross-resource redemption the AAD docs
promise — **leave the critical path under D1** and become V2 questions.

**Cheaper than feared:** no MSAL dependency. The brief's instinct to hand-roll
~30 lines of `fetch` is positively supported, since the documented MSAL path is
the browser one carrying the 24-hour refresh token we cannot use. And under D1
the token story collapses to a single Graph token — the multi-resource,
one-consent finding in S2 is now insurance for a V2 picker rather than MVP
work.

**More expensive than feared:** the throttling circuit breaker is real work and
cannot be per-request (D7); and folder expansion has to fan out into batched
jobs rather than swelling a single one (D5), because our import path is built
around ≤500 items per job.

**What we gave up.** The familiar Microsoft picker, and with it "Recent" and
"Shared with me" as entry points — D1 browses the user's own drive only. That
is a real UX regression against how Drive and Dropbox import feel here, and the
reason it is acceptable is that §1's actual demand is *pick a folder, get the
tree*, which our own list serves as well. Revisit if users ask for shared
files.

---

### Part 3 — MVP scope: the calls

#### D1 — No v8 picker. Browse the drive through Graph, in our own UI. **(deviates from §7.2/§7.3)**

Drive and Dropbox use vendor pickers, so consistency argues for one here. But
those are drop-in SDKs — one script tag. **The v8 picker is not an SDK**: it is
a hand-rolled `postMessage` handshake, a command loop
(`authenticate`/`pick`/`close`), origin validation, an iframe-or-popup form POST,
a per-account-type `baseUrl`, and a *second* token against a *different*
resource. The comparison is not "picker vs custom UI", it is "protocol + dual
tokens vs a list view".

We must write `listChildren` regardless — it is the folder walk. Browsing is
that same call with a breadcrumb over it. So D1 does not add a component, it
*reuses* one, and in exchange it deletes:

- **S2 in its entirety** — one Graph token, no SharePoint resource, no
  multi-resource authorize, no `.default`-vs-dynamic trap. The brief calls S2
  "the single biggest time sink in this integration"; the cheapest way to spend
  zero time on it is to not need it.
- **S1 in its entirety** — no `baseUrl`, so no runtime tenant discovery.
- §7.3 and its whole test row in §10.

No privacy cost: the picker's app registration asks for `Files.Read` too, so
the consent the user sees is the same either way.

Deferred to V2, tracked, not forgotten. If the picker is ever wanted, the OAuth
and import halves built here are unchanged — only the selection UI swaps.

#### D2 — Recursive `/children`, **not** `/delta`. C2 stands as written.

My earlier recommendation was the opposite; the delta reference reversed it.
Three reasons:

1. **Delta is root-scoped.** All five documented HTTP forms are `…/root/delta`
   — there is no item-scoped form in the v1.0 HTTP list. (The auto-generated SDK
   snippets on that page *do* show `.Items[…].Delta`, contradicting the HTTP
   list above them. Do not trust the snippets.) A user who picks one folder
   would have their entire drive enumerated.
2. **Delta drops the path**: *"The `parentReference` property on items won't
   include a value for **path**."* We store `files.source_path` for
   display/clustering, so we would have to rebuild the tree from parent ids by
   hand — work that the `/children` walk gets for free.
3. Delta additionally returns `deleted` items and can answer `410 Gone` with a
   resync contract. More code, not less.

The honest cost: *"paging through the `children` collection … [is] not
guaranteed to return every single item if any writes take place during the
enumeration."* We accept that. A missed file is not corruption — `content_hash`
dedup (ADR 0011/0032) makes a re-import idempotent, so the remedy is running it
again. For an archive folder that nobody is writing to mid-import, this is the
right trade.

#### D3 — Relax C6 to *bounded* buffering. Reuse `MAX_IMPORT_BYTES`.

Streaming OneDrive alone means a divergent download path; streaming everything
is a pipeline-wide refactor outside this slice; and `exiftool-vendored` reads a
path, not a stream, so the bytes land on disk regardless.

The reframe that makes this safe: **the RAM risk was never one buffer, it is
concurrency × buffer.** C6's own worry (RAW at 25–80 MB) is already covered by
the existing 200 MB cap. So split the two limits, which the brief conflates
into one `ONEDRIVE_CONCURRENCY`:

- **listing** — concurrency 4. Small JSON, no memory pressure.
- **downloads** — concurrency **1**, matching today's serial ingest loop. Worst
  case stays one `MAX_IMPORT_BYTES` buffer, exactly as Drive and Dropbox behave
  today.

#### D4 — Both account types, one code path. No personal/business split.

This decision is *created* by D1. With the picker gone there is no `baseUrl`, no
per-account authority, no SharePoint scope — both types hit identical Graph
endpoints under identical `Files.Read`. Keep `MS_TENANT=common`.

The only business-specific reality left is `takenDateTime`-only facets, and
§8.4's policy (facets pre-fill, local extraction is truth) already absorbs that
without a branch. Store `accountType` in `provider_metadata` for support
triage. Business remains **untested** until a work account exists — ship it,
say so, don't gate it.

#### D5 — Folder expansion fans out into batched `ingest` jobs.

`POST /api/imports` caps at 500 items and one job. A folder holding 18,000
photos cannot become one job without breaking progress reporting, retry
granularity and ADR 0032's error containment.

So the ingest handler, on seeing a `folder` facet, walks and **enqueues further
`ingest` jobs in batches of ≤500**. No new job type — C8 holds, and the
"seven handlers, one per `jobTypeSchema` member" invariant is untouched.
Handlers already enqueue work (analyze → cluster), so this is an existing
pattern.

This also removes §8.2's resumable-cursor requirement from the MVP: each batch
is independently retryable, and a crash mid-walk retries the parent, which
dedup makes idempotent. Cap at `ONEDRIVE_MAX_ITEMS_PER_IMPORT` = **5000** for
MVP, not the brief's 25000 — smaller blast radius on a limit we have never
exercised. `ONEDRIVE_MAX_DEPTH` = 10 stays; it is cheap and guards against
shortcut cycles.

#### D6 — Count before import: estimate from `folder.childCount`, don't pre-walk.

§7.4 is right that a photographer must not be ambushed by an 18,000-file
ingest, but a pre-walk to show the number *is* the expensive operation. The
children listing already carries `folder: { childCount: N }` for free. Show
that (direct children, labelled as an estimate) at selection, then real numbers
through `progress_label` during the walk.

#### D7 — Throttling: a connection-scoped circuit breaker, not per-request backoff.

Required by the docs' *"pause all further requests"*. Since D3 puts downloads
at concurrency 1, this stays small: one `pausedUntil` timestamp per connection
that every request awaits before firing. Honour `Retry-After` on **429 and
503**; exponential backoff with jitter only when the header is absent.

#### Still blocked on a human

**The Azure app registration (§3).** D1 shrinks it — no SPA registration, no
SharePoint delegated permissions, just Web platform + `offline_access`,
`User.Read`, `Files.Read`. Every remaining live test hangs off it.

### Azure app registration — the runbook

D1 shrank this: no SPA registration, no SharePoint delegated permissions, no
picker resource. What is left is one Web app registration with three scopes.

1. **entra.microsoft.com** → Applications → App registrations → **New
   registration**. A personal Microsoft account can do this; it gets a default
   directory automatically.
2. **Name**: `ArchiveMind` — users read it on the consent screen.
3. **Supported account types**: *"Accounts in any organizational directory
   (Any Microsoft Entra ID tenant – Multitenant) and personal Microsoft
   accounts (e.g. Skype, Xbox)"*. This is the only option that yields
   `signInAudience: AzureADandPersonalMicrosoftAccount`; anything narrower and
   `MS_TENANT=common` cannot serve both account types (D4).
4. **Redirect URI**: platform **Web** — *not* Single-page application — set to
   `https://www.archivemind.media/api/sources/onedrive/oauth/callback`.
   A `spa` redirect URI caps refresh tokens at **24 hours**, which would strand
   the worker the day after an import. This is the single most consequential
   click in the whole registration.
5. **Authentication** → add `http://localhost:3000/api/sources/onedrive/oauth/callback`
   (http is permitted for localhost only). Leave the implicit-grant checkboxes
   **off** — this is the code flow. Vercel previews get a fresh hostname per
   deployment and therefore cannot work here; test on localhost or production.
6. **Certificates & secrets** → New client secret. Copy the **Value** column
   immediately (not "Secret ID") — it is shown once. Record the expiry: when it
   lapses every connection silently stops refreshing.
7. **API permissions** → Microsoft Graph → *Delegated*. The final list is
   exactly three: `offline_access`, `User.Read`, `Files.Read`. Admin consent is
   not required — all three are user-consentable. Do **not** add
   `Files.Read.All`, `Sites.Read.All`, `AllSites.Read` or `MyFiles.Read`: the
   picker documentation asks for those, and D1 means we have no picker.
8. **Manifest** → confirm `"signInAudience": "AzureADandPersonalMicrosoftAccount"`.

**Where the variables go** (they differ, because only the web app performs the
authorization-code leg — the worker only ever redeems a refresh token, and that
grant takes no `redirect_uri`):

| Variable | Vercel (web) | Railway (worker) |
| --- | --- | --- |
| `MS_CLIENT_ID` | ✅ | ✅ |
| `MS_CLIENT_SECRET` | ✅ | ✅ |
| `MS_REDIRECT_URI` | ✅ | — |
| `MS_TENANT=common` | ✅ | ✅ |

`TOKEN_ENC_KEY` must be **identical** in both (it already is, for Drive): the
web encrypts the refresh token, the worker decrypts it.

`MS_REDIRECT_URI` must match a registered URI byte for byte — scheme, host,
path, no trailing slash — and is per-environment, not a wildcard. A mismatch
fails as `AADSTS50011` on Microsoft's own page, before the request ever reaches
us.

Publisher verification stays deferred, so organizational users see "unverified"
on the consent screen. Personal accounts do not.

### Found while building

Two things the spike could not have predicted, both worth keeping:

- **`source_connections` carries COLUMN-level grants.** `init.sql:365` revokes
  table-wide `select` from `authenticated` and re-grants a fixed column list,
  so the token ciphertexts stay unreadable even to a member whose RLS lets them
  see the row. A column added after that revoke is therefore invisible by
  default — `provider_metadata` needed an explicit
  `grant select (provider_metadata)`, and without it a `select *` would have
  started failing for *every* caller, not just the new column. Pinned by
  `supabase/tests/019_onedrive_sources.sql`, which also asserts
  `refresh_token_enc` stayed unreadable.
- **Part 2's item 6 is moot for the MVP.** It said the picked-item schema must
  make `name`/`isFolder` optional, because the v8 picker guarantees only
  `id` + `parentReference.driveId`. Under D1 there is no picker: our own browse
  response is the producer, so those fields are required and validated. The
  correction stands for whoever adopts the picker in V2, and the schema
  comment says so.

### Not done

`.env.example` is untouched — the four `MS_*` vars must be added by hand
(tooling here is fenced away from `.env*`, correctly). No `CHANGELOG.md` exists
in this repo, so §11's changelog item has nothing to update. The migrations are
authored and verified against a clean local `supabase db reset`, but **not
applied** — that is the migrations owner's job, PR-only. `CLAUDE.md`
deliberately untouched per §11: provider specifics belong here and in
`ARCHITECTURE.md`.

Everything under "Still needs a live account" above remains untested, because
the Azure app registration has not been done.
