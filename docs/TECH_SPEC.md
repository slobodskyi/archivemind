# ArchiveMind — MVP Technical Specification

Version: 1.2 · Date: 2026-07-06 · Status: approved for build
Team: 2 developers (AI-assisted). Source doc for `CLAUDE.md`, kickoff prompts, and `docs/`.

**v1.2 (2026-07-06):** Asset ≠ File domain model — the canonical entity is `assets`; `files` are physical representations (FK → asset). Previews, EXIF, tags, captions, facts, embeddings, and project membership all reference `asset_id`. Ripples through §5–§10. See ADR 0011.
**v1.1 (2026-07-06):** folds the 2026-07-03 pre-build verification amendments (A1–A14, formerly `PLAN.md` §0) directly into the sections below, plus the `generateContent`-over-Interactions correction (§2 row 12, §8, ADR 0007). No superseded model ids / libraries / spikes remain.

---

## 1. Product summary

AI archive workspace for documentary photographers / photojournalists whose files are scattered across local disks, Google Drive, and Dropbox. The product unifies sources into one workspace, runs AI analysis (attribute-level recognition, tags, multilingual captions), and provides composite natural-language search that combines EXIF metadata (where/when) with AI content understanding (what) — e.g. *"mustached men I shot in Odesa"*.

**User journey (MVP):**
1. Sign up → workspace auto-created (team-ready: workspace has members).
2. Connect Google Drive / Dropbox (OAuth, narrow scope) → pick files/folders via Picker/Chooser; and/or direct upload of local files.
3. Files appear on the infinite canvas (neural view: source → folder clusters). "Organize" re-clusters by source / date / place / similarity; manual drags persist as overrides; undo/redo client-side.
4. Create projects; add files from any source (M:N).
5. Run AI actions on selection or project: **Smart analyze** (tags + embeddings + draft facts), **Generate captions** (EN/UK/RU × Social/Agency/Archival, promptable), **Smart search** (NL → metadata filters + semantic).
6. Review in drawer (captions, tags, EXIF, facts) → confirm facts → export the selection — a laid-out PDF, a captions CSV, or a ZIP of the files.

**Import model:** snapshot import (no live sync). Google Drive originals stay in the source (worker streams the bytes at processing time); Dropbox originals and local uploads are stored in full in R2 (Dropbox direct links can't be re-fetched — ADR 0008). We always keep derivatives (previews, EXIF, tags, captions, embeddings). "Add more files" = re-open picker.

---

## 2. Architecture overview

```
Browser (Next.js on Vercel)
  │  supabase-js (anon key + RLS)          ── auth, reads, Realtime job progress
  │  Route handlers (/api/* + /auth/*)     ── presign R2 uploads, sign-in PKCE exchange,
  │                                           source OAuth, enqueue jobs, search
  ▼
Supabase Postgres (+ Auth, + pgvector, + Realtime)
  ▲
  │  session-pooler connection (service role)
Worker (Node/TS on Railway, persistent container)
  ── claims ai_jobs (FOR UPDATE SKIP LOCKED)
  ── fetches bytes: R2 / Drive API / Dropbox direct links (streaming)
  ── previews (sharp), EXIF (exifr / exiftool-vendored), HEIC decode, PDF text
  ── Gemini: analyze (gemini-3.1-flash-lite via generateContent), captions, embeddings
  ── writes results → Postgres; progress → ai_jobs row (Realtime picks it up)
Cloudflare R2 (S3-compatible)
  ── originals (uploads + Dropbox), previews (all assets), exports
  ── immutable publication-preview copies (anonymous share links; ADR 0046)
```

**Decision log (ADR-lite):**

| # | Decision | Rationale |
|---|---|---|
| 1 | Monorepo (pnpm + turborepo): `apps/web`, `apps/worker`, `packages/shared` | 2 devs, shared TS types, no API drift. Existing mockup repo moves to `apps/web`. |
| 2 | Web on Vercel, worker on Railway | Serverless can't do long batch jobs (sharp, streaming, retries); persistent container can. |
| 3 | Queue = `ai_jobs` table + `FOR UPDATE SKIP LOCKED` (no pgmq, no Redis) | One table = queue + history + Realtime progress source; trivially inspectable; enough for thousands of files. |
| 4 | Storage = Cloudflare R2 | Zero egress (media app serves lots of previews); S3-compatible presigned URLs. Supabase Storage unused — all binaries live in R2. |
| 5 | Embeddings = **gemini-embedding-2** (multimodal, GA — not the deprecated `-preview` id) @ **768 dims** (auto-normalized). **No fallback** — `gemini-embedding-001` shuts down 2026-07-14 and its vector space is incompatible. | Killer feature is visual attribute search → embed the image itself, same space as text queries and PDF chunks. Spaces between models are incompatible → decide at build start, no mid-flight switch. |
| 6 | Captions/analysis = **`gemini-3.1-flash-lite`** via `GEMINI_ANALYZE_MODEL` env (structured output) | ~$0.31–0.35 / 1000 images ($0.25/M in, $1.50/M out), multilingual EN/UK/RU, JSON schema support. `media_resolution` exposed per call (medium for tags, high when OCR matters). Re-verify model at Phase 2. See ADR 0010. |
| 7 | Drive via Google Picker + `drive.file` (**multi-file select**; folders = navigation only); Dropbox via Chooser **direct links, zero OAuth** (originals streamed once → stored in R2) | Avoids CASA verification (~$800–1500/yr + weeks). Access limited to user-picked items. Drive folder sync / full-Dropbox OAuth → post-MVP. See ADR 0008. |
| 8 | Snapshot import, no live sync | Live sync needs broad scopes (`drive.readonly`, watch channels) → CASA + polling infra. Phase 2+. |
| 9 | Files are workspace-global; projects are M:N curated subsets | "All my files" = workspace; one file can live in many projects. |
| 10 | Attribute-level recognition only ("man with mustache"), no identity/face-ID | No consent/GDPR burden in MVP; person-attributes are tags. |
| 11 | No enforced usage limits in MVP, but **every AI action logged** in `usage_events`. The credit model is now **defined and metered, still not enforced** (ADR 0037): `1 credit = 1 AI action on 1 photo`; `plans` carries limits with `enforced = false` on every row | Data for the future credits model from day 1 — and, since 2026-07-27, a definition of what a credit *is*, so today's numbers are the ones a bill would use. |
| 12 | AI seam = **`generateContent` + `responseSchema`**, not the Interactions API | Calls are single-shot (analyze/caption/search, no multi-turn state) and bulk ingest depends on the **Batch API**, not yet on Interactions. Pin `@google/genai`; re-verify at Phase 2. See ADR 0007. |

---

## 3. Monorepo layout

```
archive-mind/
├── apps/
│   ├── web/                        # Next.js App Router (ported mockup lives here)
│   │   ├── app/
│   │   │   ├── (app)/              # authed shell: canvas, projects, drawer, search
│   │   │   ├── api/                # route handlers (see §9)
│   │   │   └── auth/               # supabase auth callback
│   │   ├── components/             # from the mockup port (canvas/, drawer/, ...)
│   │   ├── hooks/
│   │   └── lib/
│   │       ├── api.ts              # SWAP POINT: mock → real fetchers (see §10)
│   │       └── supabase/           # browser + server clients
│   └── worker/
│       ├── src/
│       │   ├── index.ts            # poll loop + graceful shutdown
│       │   ├── queue.ts            # claim / heartbeat / complete / retry / reaper
│       │   ├── retention.ts        # periodic sweeps (trashed projects + trashed assets, §7/ADR 0033)
│       │   ├── handlers/           # ingest.ts, analyze.ts, caption.ts, export.ts
│       │   ├── services/           # gemini.ts, embeddings.ts, r2.ts, exif.ts,
│       │   │                       # previews.ts, heic.ts, raw.ts, pdf.ts,
│       │   │                       # gdrive.ts, dropbox.ts, tokens.ts
│       │   └── db.ts               # pg Pool (session pooler URL)
│       └── Dockerfile              # node:22-slim (perl-base; poppler-utils only if pdf-parse v2 falls short)
├── packages/
│   └── shared/                     # zod schemas + types: domain, job payloads,
│                                   # API contracts, prompt templates
├── supabase/
│   ├── migrations/                 # SINGLE OWNER (assign one dev; PR-only changes)
│   └── config.toml
├── docs/  (ARCHITECTURE.md, decisions/, openapi.yaml later)
├── CLAUDE.md
└── turbo.json · pnpm-workspace.yaml · package.json
```

---

## 4. Data model (Postgres / Supabase)

Conventions: `uuid` PKs (`gen_random_uuid()`), `created_at timestamptz default now()`, `updated_at` via trigger, every domain table carries `workspace_id` for RLS.

```sql
create extension if not exists vector;

-- ============ identity & tenancy ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- the byline exported deliverables carry (20260727000001). Read by every
  -- member, written only by the owner — no new policy, workspaces_update is
  -- already is_owner. Nullable: an archive with no byline is a valid state.
  creator text, credit text, copyright_notice text, usage_terms text,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

create type member_role as enum ('owner','editor','viewer');
create table memberships (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role member_role not null default 'editor',
  created_at timestamptz default now(),
  primary key (workspace_id, user_id)
);

-- ============ sources ============
create type source_provider as enum ('gdrive','dropbox');
create table source_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id),
  provider source_provider not null,
  provider_account_email text,
  access_token_enc text,      -- encrypt: Supabase Vault or app-level AES-GCM (key in worker env)
  refresh_token_enc text,
  scopes text[],
  status text not null default 'active',   -- active | revoked | error
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ============ assets & files ============
create type asset_kind   as enum ('photo','pdf','document','other');
create type asset_status as enum ('active','source_missing','deleted');
create type file_origin  as enum ('upload','gdrive','dropbox');

-- Canonical entity: one shot / document. Everything AI/curation references the ASSET.
create table assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  added_by uuid references profiles(id),
  kind asset_kind not null,
  title text,                        -- display name (set from the first file at ingest)
  status asset_status not null default 'active',
  ai_processed_at timestamptz,       -- last successful analyze
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index assets_ws_kind_idx    on assets (workspace_id, kind);
create index assets_ws_created_idx on assets (workspace_id, created_at desc);

-- Physical representations of an asset (original, alt formats, cloud-linked bytes).
-- One asset → many files; one file → one asset.
create table files (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,  -- denormalized: RLS + dedup index
  origin file_origin not null,
  source_connection_id uuid references source_connections(id),
  source_file_id text,               -- Drive/Dropbox file id
  source_path text,                  -- folder path at import time (display/clustering)
  r2_key text,                       -- set for uploads AND Dropbox; null only for Drive-linked files
  mime_type text,
  byte_size bigint,
  content_hash text,                 -- sha256 (computed during ingest)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index files_asset_idx on files (asset_id);
create unique index files_dedup_idx on files (workspace_id, content_hash)
  where content_hash is not null;
-- Dedup: sha256 per file at ingest. On hash conflict do NOT create a new asset —
-- attach the incoming file as another representation of the existing asset (or just
-- link that asset into the target project).

-- Previews + EXIF describe the SHOT, so they hang off the ASSET, not a byte blob.
create table asset_previews (
  asset_id uuid not null references assets(id) on delete cascade,
  size text not null,                -- 'thumb'(256) | 'medium'(1024)
  r2_key text not null,
  width int, height int,
  primary key (asset_id, size)
);

create table asset_exif (
  asset_id uuid primary key references assets(id) on delete cascade,
  taken_at timestamptz,
  camera_make text, camera_model text, lens text,
  gps_lat double precision, gps_lon double precision,
  gps_label text,                    -- reverse-geocoded or manual
  location_source text,              -- 'gps' | 'manual' | 'ai'  (pro cameras often have NO GPS)
  iso int, aperture text, shutter text, focal_length text,
  raw jsonb                          -- full EXIF dump
);
create index asset_exif_taken_idx on asset_exif (taken_at);

-- ============ projects ============
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  caption_prompt text,               -- per-project caption tone/instructions
  archived_at timestamptz,           -- soft state: tucked away, still readable
  deleted_at timestamptz,            -- soft state: in trash; drives the 30-day sweep
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index projects_ws_active_idx on projects (workspace_id)
  where archived_at is null and deleted_at is null;

-- Retention: hard-deletes trashed projects past the window. project_assets
-- cascades; assets are workspace-global and survive (rule 9). Scheduled by the
-- worker (§7), not pg_cron. See ADR 0019.
create function sweep_trashed_projects(retention interval default interval '30 days')
returns integer ...   -- security invoker: trusted caller sweeps all, others stay RLS-scoped

create table project_assets (
  project_id uuid not null references projects(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  added_by uuid references profiles(id),
  added_at timestamptz default now(),
  primary key (project_id, asset_id)
);

-- ============ AI outputs ============
create type tag_category as enum ('object','scene','place','attribute','event','other');
create type tag_source   as enum ('ai','manual','exif');

create table tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  category tag_category not null default 'other',
  unique (workspace_id, name, category)
);

create table asset_tags (
  asset_id uuid not null references assets(id) on delete cascade,
  tag_id   uuid not null references tags(id)  on delete cascade,
  source tag_source not null default 'ai',
  confidence real,
  primary key (asset_id, tag_id)
);

create type caption_lang  as enum ('en','uk','ru');
create type caption_style as enum ('social','agency','archival');

create table captions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  lang caption_lang not null,
  style caption_style not null,
  text text not null,
  is_edited boolean not null default false,
  generated_by text,                 -- model id
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (asset_id, lang, style)
);

create type fact_status as enum ('confirmed','likely','needs_check');
create table facts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  text text not null,
  status fact_status not null default 'needs_check',
  source text,                       -- 'exif' | 'gps' | 'ai' | 'manual'
  confirmed_by uuid references profiles(id),
  confirmed_at timestamptz,
  created_at timestamptz default now()
);

-- ============ embeddings (unified: photos + doc chunks) ============
create table embeddings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  kind text not null,                -- 'image' | 'doc_chunk'
  chunk_index int not null default 0,
  content text,                      -- embedded text (doc chunks) or AI description (audit / re-embed / fallback)
  embedding vector(768) not null,
  created_at timestamptz default now(),
  unique (asset_id, kind, chunk_index)
);
create index embeddings_hnsw_idx on embeddings using hnsw (embedding vector_cosine_ops);
create index embeddings_ws_idx   on embeddings (workspace_id);
-- pgvector HNSW indexes support ≤ 2000 dims → 768 is safe.
-- Embedding spaces are model-specific: switching models later requires full re-embed.

-- ============ jobs & usage ============
create type job_type   as enum ('ingest','analyze','caption','export');
-- appended since init, each by its own migration: 'cluster' (20260722000001),
-- 'edit' (20260722000003), 'purge' (20260723000001). Seven values, seven handlers.
create type job_status as enum ('queued','running','done','failed','canceled');

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references profiles(id),
  project_id uuid references projects(id),
  type job_type not null,
  status job_status not null default 'queued',
  payload jsonb not null,            -- {asset_ids:[], langs:[], style, options...}
  progress int not null default 0,   -- 0..100
  progress_label text,
  total_items int, done_items int,
  error text,
  cost_usd numeric(10,5),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index ai_jobs_queue_idx on ai_jobs (run_after, created_at) where status = 'queued';

create table usage_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  user_id uuid,
  job_id uuid references ai_jobs(id),
  event_type text not null,          -- image_analyzed | caption_generated | embedding |
                                     -- pdf_processed | search_query | export |
                                     -- asset_ingested  (added 20260727000002)
  units int not null default 1,
  model text,
  cost_usd numeric(10,6),            -- estimate, from packages/shared USD_PER_UNIT;
                                     -- internal margin only, never shown to a user
  created_at timestamptz default now()
);
create index usage_ws_idx on usage_events (workspace_id, created_at);
-- Migration 20260727000002 (ADR 0037) adds `usage_events.bytes bigint` (ingest),
-- a `plans` catalog + `workspaces.plan`, byte columns on `asset_previews` and
-- `asset_edits`, and the `workspace_usage(ws)` RPC behind the Usage & Storage
-- view. Like topic_clusters / asset_edits / canvas_groups, those tables live in
-- their migrations and ADRs rather than in this block, which stays the
-- migration-0001 design.
-- Migration 20260727000003 (ADR 0038) adds `topic_clusters.is_renamed` — a human
-- named this cloud, so the worker must preserve its label and must not delete it
-- when its centroid stops matching. It is the repo's SECOND column-level ACL
-- (after the source_connections token columns): the blanket UPDATE grant is
-- revoked and re-granted on (label, is_renamed) only, because the same row holds
-- the k-means `centroid` and a forged one corrupts every future clustering of
-- the workspace rather than a single row.
-- Migration 20260810000001 (ADR 0042) separates the worker-owned Topic answer
-- from human curation. `topic_clusters.origin` is `generated | manual`;
-- generated rows keep a non-null centroid, while manual rows have no centroid
-- and never enter worker matching. `topic_cluster_overrides` stores at most one
-- human destination per asset (RLS SELECT; writes only through the narrow,
-- editor-gated `create_manual_topic`, `assign_topic_assets` and
-- `delete_manual_topic` RPCs). Its FK is ON DELETE RESTRICT. The read rule is:
--
--   effective topic = manual override ?? assets.cluster_id ?? tag heuristic
--
-- Deleting an override is therefore a lossless "Return to AI"; it never
-- rewrites the latest k-means baseline. Migration on prod 2026-08-10 (linked
-- ledger + clean post-push dry-run; local Docker 500 blocked `db diff`).

-- ============ canvas layouts ============
create table canvas_layouts (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  scope text not null,               -- 'all' or project uuid as text
  overrides jsonb not null default '{}'::jsonb,  -- {hub:{...}, folder:{...}, asset:{id:{x,y}}}
  organize_mode text,                -- 'source' | 'date' | 'place' | 'similarity'
  updated_at timestamptz default now(),
  primary key (workspace_id, user_id, scope)
);
```

**Publication shares (migration `20260813000002`, ADR 0046).** A
browser-local content draft becomes durable only at the explicit Share
boundary. `publication_shares` stores one immutable, publishable Article or
Carousel snapshot, frozen rights, a SHA-256 token digest and
`preparing|ready|revoked` lifecycle; `publication_share_assets` maps its opaque
public media ids to share-owned preview copies and permitted download sources.
The raw token, real asset ids and R2 keys never enter the public snapshot. Both
tables have RLS with no direct `anon`/`authenticated` table or resolver access:
editor creation/activation/revocation uses three guarded SECURITY DEFINER RPCs;
the fenced Next server integration invokes two service-role-only resolvers and
projects their results before responding. See §8.7 and §9.

---

## 5. Auth & RLS

- Supabase Auth (email + Google OAuth login). On first login, app creates `profiles` row, a default workspace, and an `owner` membership (app code, not DB trigger — easier to evolve).
- RLS enabled on **every** domain table. Membership check via `security definer` helper to avoid policy recursion:

```sql
create or replace function is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where workspace_id = ws and user_id = auth.uid());
$$;

-- pattern for tables that carry workspace_id (assets, files, embeddings, tags, projects, ai_jobs, ...):
alter table assets enable row level security;
create policy assets_select on assets for select using (is_member(workspace_id));
create policy assets_write  on assets for all
  using (is_member(workspace_id)) with check (is_member(workspace_id));
-- asset-child tables (asset_previews, asset_exif, asset_tags, captions, facts,
--   project_assets) have no workspace_id → authorize via their asset's workspace:
--   using (is_member((select workspace_id from assets a where a.id = asset_id)))
--   (wrap in a security-definer helper is_member_of_asset(asset_id) to keep policies terse).
-- memberships table itself: select via is_member(workspace_id);
-- insert/delete restricted to role 'owner' (second helper: is_owner(ws)).
```

- Roles in MVP: `owner` (manage members), `editor` (default; full content access), `viewer` (read-only; enforce in write policies with `is_editor(ws)` helper). Keep policies coarse — refine post-MVP.
- Worker connects via **session pooler** connection string (service role, bypasses RLS). Direct 5432 is IPv6-only on Supabase (Railway has no outbound IPv6) — do not use; **never use the transaction pooler (6543)** either (no LISTEN / prepared statements). pg `Pool` with `max: 2–5`; IPv4 add-on ($4/mo) only as an escape hatch.
- Web: `anon` key in browser (RLS enforced); `service_role` key only inside route handlers that must cross RLS (rare; prefer RLS-scoped queries).
- OAuth tokens (Drive/Dropbox): encrypted at rest (Supabase Vault, or AES-GCM with `TOKEN_ENC_KEY` env known only to worker + API routes). Never sent to browser.
- Realtime: job progress via **Broadcast from Database** — an `AFTER UPDATE` trigger on `ai_jobs` calls `realtime.broadcast_changes()` (ships in migration 0001); clients join a **private** channel per `workspace_id` with `setAuth()`, gated by an RLS policy on `realtime.messages`. (Not `postgres_changes`: single shared WAL reader + per-subscriber RLS re-checks — same effort, worse scaling.) See ADR 0009.

---

## 6. Storage layout (R2)

```
{workspace_id}/originals/{uuid}/{filename}        -- per FILE (physical); uploads AND Dropbox
                                                  -- (uuid is minted at presign/fetch time,
                                                  --  before the files row exists — NOT files.id)
{workspace_id}/previews/{asset_id}/thumb.webp     -- per ASSET; 256px long edge
{workspace_id}/previews/{asset_id}/medium.webp    -- per ASSET; 1024px long edge
{workspace_id}/exports/{job_id}.{pdf|csv|zip}     -- extension per options.format; only the KEY is
                                                  -- stored (payload.result_key), presigned per request;
                                                  -- swept after EXPORT_RETENTION_DAYS
{workspace_id}/shares/{share_id}/previews/{public_id}.webp
                                                  -- immutable medium copy for one public publication
```

- Uploads: browser → `POST /api/uploads/presign` → presigned PUT direct to R2 → `POST /api/uploads/complete`. Multipart (>100 MB) uses a **fixed chunk size (~50 MiB; all parts equal except the last)**; bucket CORS must set `ExposeHeaders: ["ETag"]` (else the browser can't complete multipart); no unsigned headers on part PUTs; no POST-policy uploads (unsupported on R2). Max presigned TTL 7 days.
- Cloud-linked files (**Drive only**): originals never copied; worker streams bytes at processing time (Drive `files.get?alt=media`), keeps only previews + derived data. **Dropbox** (Chooser direct links, 4 h TTL) is fetched once at ingest and its original is stored in R2 like an upload — the link can't be refreshed later (ADR 0008).
- All preview serving via presigned GET or public bucket + Cloudflare CDN — zero egress cost either way.
- Public publication media stays private in R2 and is the one path that is
  **never presigned to the browser at all**. Each picture and file is requested
  from a same-origin `/p/{token}/media/…` handler, which hashes the token afresh
  and streams the object through; R2's host, signature and durable key never
  reach the page, and a turned-off link stops answering on the next request
  rather than one TTL later. Upload/Dropbox may expose the stored original,
  while Drive is labelled and delivered as the share-owned 1024px WebP
  (ADR 0046).

---

## 7. Job queue & worker

**Claim (atomic):**
```sql
update ai_jobs set status='running', claimed_by=$1, claimed_at=now(),
       started_at=coalesce(started_at, now()), attempts=attempts+1
where id = (select id from ai_jobs
            where status='queued' and run_after <= now()
            order by created_at
            for update skip locked
            limit 1)
returning *;
```

- **Loop:** poll every 2s when idle; process; update `progress/progress_label/done_items` every N items (Realtime propagates to UI).
- **Retry:** on error, if `attempts < 3` → `status='queued', run_after = now() + (attempts * interval '2 min')`, else `failed` + `error`.
- **Reaper:** every 5 min, `running` jobs with `claimed_at < now() - interval '15 min'` → back to `queued` (crash recovery).
- **Retention sweeper:** on boot, then every 6 h, five independent sweeps, each caught separately so one failure cannot stall the others: `sweep_trashed_projects()` and `sweep_trashed_boards()` hard-delete expired Trash rows; `sweep_deleted_assets()` enqueues `purge` jobs; `sweepExpiredExports()` deletes expired export artifacts and strips their `result_key`; `sweepPublicationShares()` terminally revokes expired/abandoned publications, deletes only their exact share-owned R2 previews, and then removes the private asset mappings while retaining the parent row and token digest forever. These are not `ai_jobs`: they are retention maintenance, not user-triggered work. Failures are logged and retried on the next tick. See ADR 0019, ADR 0035 and ADR 0046.
- **Idempotency:** handlers upsert by natural keys (`asset_previews` PK, `captions (asset_id,lang,style)`, `embeddings (asset_id,kind,chunk_index)`) — safe to re-run.
- **Rate limiting:** exponential backoff on 429/5xx around every Gemini call (`services/gemini.ts`) — shipped. A worker-side parallelism cap is **not** implemented: analyze (like ingest) runs sequentially by design, so there is nothing to cap yet.
- Graceful shutdown: finish current item, release job back to `queued`.

---

## 8. AI pipeline

### 8.1 Ingest (`type='ingest'`, payload: asset_ids)
Per file: stream bytes → sha256 (dedup check) → EXIF (`exifr`, falling back to `exiftool-vendored` whenever `exifr` yields nothing storable — RAW, **and** real iPhone HEIC, on which `exifr` throws "Unknown file format"; #113) → reverse-geocode GPS to `gps_label` offline ([ADR 0026](decisions/0026-offline-reverse-geocoding.md)) → decode:
- JPEG/PNG/TIFF/WebP → `sharp` previews (thumb 256 / medium 1024, webp).
- **HEIC:** `sharp` prebuilt binaries exclude HEIC (patents) → decode via **`heic-decode`** (maintained) to raw RGBA → `sharp(buf, {raw})`. ~1–3 s / up to ~200 MB per iPhone HEIC → cap decode concurrency to 1–2. Native fallback if throughput hurts: `@myunisoft/heif-converter`.
- **RAW (NEF/CR2/ARW):** extract embedded JPEG via `exiftool-vendored` cascade `extractJpgFromRaw → extractPreview → extractThumbnail` (no full RAW decode in MVP) → sharp. NEF/CR2 give full-res; **Sony ARW usually only ~1616×1080** (fine for grid, not full-res display). If extraction fails → mark file `kind='other'`, skip AI.
- **PDF:** `pdf-parse` v2 (pure Node — text + tables + page screenshots; may remove the poppler system dep; `pdftoppm` kept only as a fallback for malformed PDFs; `mupdf` npm is AGPL — avoid). If empty text (scanned) → send first pages to the analyze model for extraction.
Write `files.content_hash`; on a hash conflict the duplicate upload is dropped whole — file row, its now-empty asset, and the redundant R2 original (`files_dedup_idx` allows one file row per distinct content; "attach to existing asset" applies to project-linking, not a second file row). Write `asset_exif`, `asset_previews`. **Analyze runs on explicit user action** (selection → `POST /api/jobs`) — product decision 2026-07-10: AI spend stays user-triggered; `ANALYZE_ON_INGEST=true` env restores analyze-on-ingest for dev/testing.

### 8.2 Analyze (`type='analyze'`)
Per asset: medium preview → **`GEMINI_ANALYZE_MODEL`** (default `gemini-3.1-flash-lite`) via **`generateContent` + `responseSchema`** (strict JSON; not the Interactions API — ADR 0007), `media_resolution` per call (medium for tags, high when OCR matters):
```json
{ "description": "dense factual EN description, 2-4 sentences",
  "tags": [{ "name": "mustache", "category": "attribute", "confidence": 0.93 }],
  "ocr_text": "text visible in image, if any",
  "suggested_facts": [{ "text": "...", "basis": "visual|exif" }] }
```
Person-related output restricted to **attributes** (never identity). Store tags (upsert into `tags` + `asset_tags`), facts (`status='needs_check'`, except GPS/EXIF-derived → `'likely'`).
**Embedding:** `gemini-embedding-2` (GA), input = the image itself, `output_dimensionality=768` (auto-normalized) → `embeddings(kind='image')`. **One `Content` object per image** — multiple `Part`s in one `Content` collapse to a single aggregated vector (silent index corruption); no `task_type` param on embedding-2, frame the task via a text instruction. **No fallback** (`gemini-embedding-001` retires 2026-07-14, incompatible space). Same for PDF: chunk text ~1500 tokens, one `Content` per chunk → `kind='doc_chunk'`.
Per asset: 1 usage_event `image_analyzed` + 1 `embedding`. Set `assets.ai_processed_at`.

#### 8.2.1 Topic clustering (`type='cluster'`)

After analyze, deterministic spherical k-means groups stored image embeddings
and writes the machine baseline to generated `topic_clusters` rows plus
`assets.cluster_id` (ADR 0028). Editable Topics do not feed manual moves back
into that mathematics (ADR 0042): the handler locks the workspace, matches only
`origin='generated' AND centroid IS NOT NULL`, and never updates or deletes a
manual row. An unmatched generated row referenced by
`topic_cluster_overrides` is retained with baseline `size=0`; the override FK
also rejects an accidental delete. Re-cluster refreshes the AI baseline while
preserving every manual destination and costs zero credits (no Gemini call).
Soft trash keeps the override for Restore; permanent purge deletes it explicitly
because the retained asset tombstone never fires an asset-delete cascade.

### 8.3 Captions (`type='caption'`, payload: asset_ids, langs[], style)
Per asset × lang: prompt = base template (in `packages/shared/prompts.ts`, per style) + `projects.caption_prompt` (if run in project context) + known metadata (date, GPS label, confirmed facts) + medium preview → text → upsert `captions`. Editing a caption in UI sets `is_edited=true`; regenerate never silently overwrites edited captions (UI confirms).

### 8.4 Search (route handler, not a job)
1. `GEMINI_ANALYZE_MODEL` parses the query (structured output via `generateContent`) → `{semantic_text, date_from?, date_to?, place_terms[], tag_terms[], camera_terms[], iso_min?, iso_max?, aperture?, kinds[]}`. Every field is `.catch()`-guarded, so a sloppy parse degrades to plain semantic search rather than failing.
2. Embed `semantic_text` (same model/space as documents; Embedding 2 → embed query text into the multimodal space).
3. SQL (`search_assets`, **hybrid** — ADR 0031): image-embedding cosine over `embeddings` scoped to workspace (+ project filter), plus:
   - **lexical signal** → `websearch_to_tsquery('simple', …)` over the AI `description` (`embeddings.content`) + `facts.text` (GIN-indexed; `'simple'` needs no extension and doesn't stem — right for the uk/en mix). A hit is an *explicit* match;
   - dates → `asset_exif.taken_at` range;
   - places → `gps_label ILIKE` any place_term OR a `place`-category tag match;
   - EXIF filters (narrow, don't rank) → camera make/model/lens ILIKE, `iso` range, aperture ILIKE;
   - tags → `asset_tags`, exact term or whole-word of a multi-word tag.
4. **Ranking is tiered (ADR 0029), not raw cosine.** Explicit matches — a matched tag, place, or lexical hit — sort to the front and read as "strong"; the rest are cosine-only and collapse behind "show more" in the UI. Return top-N with a `matched_tags`/`matched_place`/`matched_text` explanation (UI shows *why* it matched — accent border + "in description").
Graceful degradation: no GPS in archive (common for pro cameras) → place matching falls back to place-tags; an EXIF filter simply drops assets missing that field. Raw OCR is not yet a source — the worker discards `ocr_text`; the `description` already carries most on-image (screenshot) text (ADR 0031, raw-OCR persistence deferred).
Log `search_query` usage_event. Latency budget: 1 analyze-model call + 1 embed + 1 SQL ≈ well under Vercel limits.

### 8.5 Export (`type='export'`)
**Shipped shape (ADR 0035 + its Amendments) — this paragraph is the current contract.**
Payload: `{group_id | asset_ids, options}` where `options` is the legacy-named
`artboardSettingsSchema`; current UI sends explicit `asset_ids`, while the
`group_id` branch remains parseable for compatibility
(`format`, page layout/size/orientation, caption lang×style, `include`, `cover`, `zipContents`). Three formats:

- `format: 'pdf'` — a laid-out document, one photo per page or a 2-up contact sheet,
  with an optional cover (title, count, date range, rights block), a `i / n` + credit
  footer on every page, real PDF metadata and a human download filename signed into the
  URL via `ResponseContentDisposition`,
  rendered from the **medium previews** (edited-medium when present). Facts are
  deliberately not printed; see the ADR amendment.
- `format: 'captions_csv'` — the caption spreadsheet this section originally
  specified: one row per photo with filename, full EXIF (camera/lens/ISO/aperture/
  shutter), place + lat/lon, tags, the AI description, facts **split into
  `facts_confirmed` / `facts_unreviewed`**, and `caption_en|uk|ru` for the chosen
  style (exact lookup — no English fallback, so an empty cell is the "still needs
  translating" signal). UTF-8 BOM + CRLF so Excel reads Cyrillic.

The worker writes the artifact to R2 `{workspace_id}/exports/{job_id}.{ext}` and puts
that **key** in `ai_jobs.payload.result_key`. `GET /api/exports` presigns it per
request; no bearer URL is stored or broadcast (the old `result_url` was readable by
every workspace member through `ai_jobs` RLS and pushed to all of them on update).
Artifacts are deleted by `sweepExpiredExports` after `EXPORT_RETENTION_DAYS`.

### 8.6 Workspace content drafts (browser-local MVP)

An open Workspace (`board`) is a source scope, not a finished page model. The
content flow is `Workspace → editable draft → delivery` (ADR 0045): Article and
Instagram-carousel generation capture an explicitly ordered asset-id snapshot,
then own structured sections/slides independent of canvas coordinates. Existing
PDF/captions-CSV/ZIP export remains the separate raw-file **Download** flow.

`POST /api/content-drafts/generate` accepts `{boardId, sourceAssetIds, kind,
brief, language, tone, options}` with at most 20 ids. It requires an authenticated
owner/editor; validates the live board, project, active files and exact board
membership before Gemini; preserves request order; and returns `{content,
model}` using a request-specific structured response schema. Specific claims may
use EXIF time/place and confirmed facts only; tags/image description are visual
hints and human-edited captions are writing references.

The first slice stores versioned, discriminated drafts in browser storage per
`boardId`, including `sourceSnapshot`, brief/settings, manual-edit tokens and
timestamps. This is deliberately not an `ai_jobs` artifact: drafts are editable
and persistent while export artifacts expire. A server-backed `content_drafts`
table/version domain requires a migration-owner follow-up. Successful calls log
`usage_events.event_type='content_generated'`, one unit per multi-photo synthesis;
credits are temporarily 0 until set-level pricing and `workspace_usage()` are
updated by an explicit product/schema decision.

- `format: 'zip'` — the bundle: `zipContents: 'originals'` ships the stored file for
  every source that has one in R2 (upload, Dropbox) and falls back to the web-size
  preview for Drive-linked assets, which have no original in R2 (ADR 0025), naming
  each substitution in a `README.txt` inside the archive — which is written even for a
  perfect bundle, because it also carries the workspace rights block (a ZIP has no footer
  and no cover, so it would otherwise reach a client with no statement of ownership); `zipContents: 'web'` ships
  1024px previews for everything. `captions.csv` is included either way. STORE-only,
  no compression (the payloads are already entropy-coded) and no zip dependency —
  `services/zip.ts` over `node:zlib`'s `crc32`. Total size is summed from
  `files.byte_size` BEFORE any fetch **and** re-checked against the running total as bytes
  arrive — the pre-flight sum is a lower bound that cannot see previews at all, since
  `asset_previews` records no size — and refused above `ZIP_MAX_TOTAL_BYTES`, because
  `putObject` is Buffer-only and an OOM would be a SIGKILL that `reapStaleJobs` then
  requeues forever.

### 8.7 Anonymous publication previews

**Shipped data boundary: migration `20260813000002`, ADR 0046.** Sharing is a
publication operation, not a live read of a Workspace or `localStorage` draft.
The authenticated route sanitizes one draft into a safe snapshot with opaque
per-publication media UUIDs, then calls `create_publication_share(...)`. The RPC
validates an owner/editor, a live board/project, 0–20 ordered active board
members, the current medium-preview/original keys and an exact
`snapshot.publicAssetIds` mapping. It stores only the SHA-256 digest of a random
32-byte URL token and returns an R2 `copy_plan` while the version remains
`preparing`.

The web copies each exact edited/original medium to the share-owned R2 prefix
from §6, then calls `activate_publication_share`; only `ready`, unexpired,
unrevoked rows resolve. `/p/{token}` is readable without an account and offers a
clean Article/Carousel view, Copy text, a text/Markdown download and separately
labelled media downloads. Three service-role-only SECURITY DEFINER resolvers sit
behind a fenced server integration — one for the page, one per rendered picture,
one per downloaded file — and the integration consumes the private key itself,
streaming the object rather than handing out a signature. The snapshot the page
receives therefore contains no R2 key at all, and every image re-validates the
token when the browser asks for its bytes, which is what keeps a lazily loaded
figure alive without widening the revocation window. Neither underlying tables
nor resolver functions are available to `anon`, and real asset/board/workspace
ids, briefs, source metadata and R2 URLs never cross the response boundary.

`GET /api/content-shares?boardId=` is the authoring counterpart: editor-only
**status** for that board's unrevoked versions, carrying `source_draft_id` and
never a token. Drafts are browser-local and the address is stored hash-only, so
without it a cleared `localStorage` would strand a live public link that nobody
could switch off.

Links expire after 7/30 days or never (author choice), and revocation is
terminal. Asset Trash/purge/hard-delete revokes every publication containing the
asset; a board hard-delete sets private provenance to null while the immutable
publication survives. Normal revocation returns copied-preview keys to the
route for immediate best-effort deletion. The 6-hour worker sweep covers
expiry, asset-triggered revocation and abandoned `preparing` rows: it validates
each exact share-owned key, deletes R2 first, then removes the private asset
mapping while retaining the parent row and token digest forever.

### Cost notes (recorded per event; re-verify current prices at Phase 2)
- `gemini-3.1-flash-lite` analyze/caption: ≈ $0.31–0.35 per 1000 images ($0.25/M in, $1.50/M out; ~half at `media_resolution=medium`, ~half again via Batch API).
- Embedding 2: $0.00012/image interactive, $0.00006 batch (≈ $0.60 / 10k photos batched); text $0.20/M ($0.10 batch).
- **Never use the free Gemini tier for user photos** — it trains on user data. Billing enabled from day 1; interactive API is fine for MVP volumes, Batch API for large bulk-ingest later.
- R2: $0.015/GB-mo storage, zero egress. Supabase Pro $25/mo.

---

## 9. API surface (Next.js route handlers)

All `/api/*` authoring routes are authed (Supabase session); workspace is derived
from membership. Two deliberate unauthenticated surfaces sit outside that rule:
`GET /auth/callback`, the PKCE code exchange that runs before a session exists
(ADR 0021), and `/p/{token}` plus its individual-media handler, a hash-gated,
read-only publication capability resolved by a fenced server integration (ADR
0046). Neither makes a domain table or resolver RPC directly available to
`anon`.

| Method & path | Purpose |
|---|---|
| `POST /api/uploads/presign` | `{filename,mime,size}` → `{uploadUrl, r2Key}` (fixed-size multipart >100 MB; server orchestrates Create/Complete; CORS `ExposeHeaders:[ETag]`) |
| `POST /api/uploads/complete` | after PUT: create `assets` + `files` row(s) → enqueue `ingest` |
| `GET  /api/assets` | list (workspace or `?projectId=`), cursor-paginated, incl. preview URLs. **Shipped half:** `?scope=trash` — the Trash view's photo list (un-purged trash + `deletedAt` for the countdown, ADR 0033) |
| `GET  /api/assets/:id` | asset + files + exif + tags + captions + facts |
| `PATCH /api/assets/:id` | rename (title), status |
| `DELETE /api/assets/:id` | **shipped** — soft delete (`status='deleted'`; the DB trigger stamps `deleted_at`, §12/ADR 0033). Single-id form (drawer); the canvas moves selections through the bulk route below. Still overlaps the status half of the PATCH row above; the two want reconciling. |
| `POST /api/assets/delete` · `/restore` · `/purge` | **shipped (ADR 0033)** — bulk trash ops on `{ids:[…]}`: soft-delete a selection · un-delete it (undo toast + Trash Restore; purged tombstones excluded) · enqueue the `purge` job ("Delete permanently"/"Empty trash" — worker erases R2 bytes + derivatives, keeps the tombstone) |
| `GET  /api/canvas?projectId=` | aggregates for neural view (workspace-wide, or scoped to a project — matches the `canvas_layouts.scope` = `'all'` \| project uuid): sources → folders → counts + first-K tile previews (lazy-load the rest) |
| `PUT  /api/canvas/layout` | persist `canvas_layouts` (scope, overrides, organize_mode) |
| `POST /api/integrations/google/connect` · `GET/DELETE /api/integrations/google` | **shipped shape (ADR 0025)** — popup code flow: the browser POSTs the one-time code (no public OAuth callback route exists); GET = status, DELETE = revoke + neuter. Tokens AES-GCM-encrypted via `packages/shared/token-crypto`. (Supersedes the sketched `GET/POST /api/sources/:provider/oauth` redirect flow.) |
| `POST /api/imports` | `{provider, items:[…]}` from Picker (Drive, multi-file) or Chooser (Dropbox, direct links) → `assets` + `files` rows → `ingest` job (worker streams Drive bytes; fetches Dropbox bytes once → R2) |
| `POST /api/projects` · `GET /api/projects` · `PATCH /api/projects/:id` | CRUD incl. `caption_prompt`. **Shipped:** `GET` takes `?scope=active\|archived\|trash`; `PATCH` does rename **and** archive/trash (`{name}` / `{archived}` / `{deleted}` → `archived_at`/`deleted_at`, ADR 0019). `caption_prompt` is not wired yet (Phase 3). |
| `POST /api/projects/:id/assets` · `DELETE .../assets/:assetId` | M:N add/remove |
| `POST /api/jobs` | `{type:'ingest'|'analyze'|'caption', assetIds}` → insert `ai_jobs`. **Not** export/edit/purge/cluster: every arm of `createJobRequestSchema` is asset-id-shaped, so each job type that isn't gets its own route |
| `POST /api/topics/recluster` | **shipped (ADR 0038)** — re-run the workspace's semantic clustering on demand. Workspace-scoped, so it is a route rather than a `createJobRequestSchema` arm. Zero credits (pure CPU over stored embeddings, no Gemini call); `queued\|running` backlog guard; `workspace_id` built from the caller's server-resolved membership, never the body |
| `PATCH /api/topics/:id` | **shipped (ADR 0038)** — rename one Topic cloud. Writes `label` + `is_renamed` and nothing else: migration `20260727000003` narrowed the UPDATE grant to those two columns, so an extra key raises 42501 rather than silently updating the k-means `centroid` |
| `GET /api/topics` | **shipped (ADR 0042; migration on prod 2026-08-10)** — list every usable destination in the current workspace, not only topics represented in the open project. Includes non-empty generated topics, protected/pinned generated topics, and manual topics |
| `POST /api/topics` | **shipped (ADR 0042; migration on prod 2026-08-10)** — `{label, assetIds}` → `{topic:{id,label}}`; atomically create a centroid-less manual topic and seed a non-empty selection |
| `PUT /api/topics/assignments` | **shipped (ADR 0042; migration on prod 2026-08-10)** — `{assetIds, clusterId|null}` → `{ok:true}`; move up to 500 assets atomically, or delete their overrides for Return to AI. `workspaceId` is never accepted from the body |
| `DELETE /api/topics/:id` | **shipped (ADR 0042; migration on prod 2026-08-10)** — delete only an `origin='manual'` topic; its overrides are removed in the same transaction, revealing each asset's unchanged AI baseline |
| `GET  /api/jobs/:id` | status (primary channel is Realtime; this is fallback) |
| `GET  /api/search?q=&projectId=` | §8.4 |
| `GET  /api/usage` | **shipped (ADR 0037)** — the Usage & Storage snapshot: storage by bucket, this month's credits, the analyzed/captioned funnel, per-project and per-source attribution, 30 days of activity. One `workspace_usage()` RPC (SECURITY INVOKER — RLS is the boundary). Only for the client-side view switch; `/account/usage` awaits the same reader server-side |
| `PATCH /api/captions/:id` | edit text (`is_edited=true`) |
| `POST /api/assets/:id/tags` · `DELETE` | manual tags (`source='manual'`) |
| `PATCH /api/facts/:id` | confirm / set status |
| `POST /api/exports` · `GET /api/exports?jobId=` | **shipped (ADR 0035 + Amendments; artboard UI retired by ADR 0044 amendment)** — enqueue an `export` job for an explicit asset set with `options.format`; 400 `too_many_assets` over `EXPORT_MAX_ASSETS`, 429 `export_backlog` over `EXPORT_MAX_IN_FLIGHT`. GET presigns `payload.result_key` **per request** and returns the job's real progress + `attempts`; the legacy `groupId` contract remains parseable for compatibility |
| `POST /api/content-drafts/generate` | **browser-local MVP (ADR 0045)** — owner/editor-only structured Article or Instagram-carousel generation from 1–20 ordered, active members of one live Workspace; returns `{content, model}`, records one `content_generated` audit event, and does not persist the draft server-side |
| `POST /api/content-shares` · `DELETE /api/content-shares/:id` | **ADR 0046** — authenticated owner/editor publishes one immutable safe draft version (reserve → copy share-owned previews → activate) or terminally revokes it. Creation returns the one raw `/p/{token}` path; Postgres stores only its SHA-256 digest |
| `GET /api/content-shares?boardId=` | **ADR 0046** — editor-only **status** of that board's unrevoked versions (`source_draft_id`, `status`, deadline), never a token. Drafts are browser-local and the address is hash-only, so this is what stops a cleared `localStorage` from stranding a live link nobody can switch off |
| `GET /p/:token` · `GET /p/:token/media/:publicAssetId` · `…/preview` | **public, read-only capability (ADR 0046)** — no account required. The page returns a noindex/no-store Article/Carousel safe projection carrying **no R2 key or signature at all**; both media handlers revalidate the live token per request and stream the object through this same origin. `/preview` renders a picture and is not gated on `allow_downloads`; the bare path is the file download and is. Invalid/preparing/expired/revoked are the same 404 |
| `GET  /api/workspace` · `PATCH /api/workspace` | **shipped** — the credit/rights block (creator · credit · copyright · usage terms, migration 20260727000001). No settings page exists, so the export dialog is its only editor; RLS is the gate (read = member, write = owner) |

Contracts as zod schemas in `packages/shared` (single source for web + worker). `docs/openapi.yaml` generated later — not an MVP gate.

---

## 10. Frontend integration (mockup → real)

The ported mockup's `lib/api.ts` is the swap point. Mapping:

| Mock fn | Real implementation |
|---|---|
| `getPhotos()` → **`getAssets()`** | `GET /api/assets` (paginated) |
| `getPhoto(id)` → **`getAsset(id)`** | `GET /api/assets/:id` |
| `getProjects()` | `GET /api/projects` |
| `getGroups()/getSources()` | derived from `GET /api/canvas` aggregates |
| bulk-AI fake progress | `POST /api/jobs` + Realtime **Broadcast** subscription (private `ai_jobs` channel per workspace) |
| canned chat replies | `GET /api/search` results panel (chat UI stays; answers = search) |

New pieces: Supabase auth screens/guard; upload flow (presign → PUT → complete) with per-file progress; Picker/Chooser launchers → `POST /api/imports`; Realtime hook `useJobProgress(workspaceId)`.

**Topic read and interaction (ADR 0042):** the asset query reads both the AI
baseline (`assets.cluster_id` → generated topic) and the optional
`topic_cluster_overrides` target, then derives one stable effective topic id and
label with `override ?? AI ?? heuristic/Unsorted` precedence. A pre-migration
deploy retries without the override relation and preserves the old AI-first
view. Empty-space tile drag remains project-local geometry; membership changes
only through a persisted cloud's explicit drop target or Move-to-topic menu;
heuristic clouds require the selection-only New topic action, and pointercancel
never writes. A semantic move clears the old Topic coordinate override and
repacks the tile. Bulk move and Return to AI update optimistically; create,
move and reset all expose Undo.

**Canvas at scale (mandatory):** the mockup renders 235 nodes; real archives are 10k–30k. Neural view must consume `GET /api/canvas` aggregates — render hubs/folders with counts, materialize individual tiles only for expanded folders / current viewport, cap simultaneously-mounted tiles (~300) and virtualize. "Organize" modes (`source|date|place|similarity`) recluster client-side from aggregate data; `similarity` uses server-provided cluster ids (post-MVP: k-means over embeddings; MVP may ship `source|date|place` only).

**Mockup quirks to replace with real data** *(status 2026-07-21 — most are done)*: ~~timeline bucketing by `hash(id)%6` → real `asset_exif.taken_at`~~ (shipped #74, now a per-day date axis — ADR 0024); ~~identical EXIF block → real per-asset EXIF~~ (shipped Phase 2); ~~no-op Regenerate → real caption job~~ (shipped #82). Still open: cosmetic bulk toggles → real job options (#87 — `runBulk` always enqueues plain analyze); the mockup `Photo` type becomes `Asset` (the v1.2 rename, lands during the build phases).

---

## 11. Environments & deploy

**Vercel (`apps/web`)** — turborepo root, project dir `apps/web`:
```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY            # server-only routes
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET / R2_S3_ENDPOINT
NEXT_PUBLIC_GOOGLE_CLIENT_ID         # browser: GIS code/token clients (ADR 0025)
NEXT_PUBLIC_GOOGLE_PICKER_API_KEY    # browser: Picker developer key (referrer-restricted)
NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER    # browser: Picker setAppId — the Cloud project NUMBER, not the client id
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   # server-only: the import OAuth client (separate from the login client)
NEXT_PUBLIC_DROPBOX_APP_KEY          # Chooser drop-in key, public by design — Chooser is zero-OAuth, so there is NO app secret
GEMINI_API_KEY                       # search-time parse + query embedding — service-account AUTH key, not a standard API key (see note below)
GEMINI_ANALYZE_MODEL                 # default gemini-3.1-flash-lite (see §8.2, ADR 0010)
TOKEN_ENC_KEY                        # AES-256-GCM key for source_connections tokens (ADR 0025); identical value on Railway
```
Exact list: [`apps/web/.env.example`](../apps/web/.env.example) is kept in sync with what the code reads.

**Railway (`apps/worker`)** — Dockerfile `node:22-slim` (`perl-base` suffices for ExifTool; add `poppler-utils` only if `pdf-parse` v2 falls short):
```
DATABASE_URL                         # Supabase SESSION POOLER (not direct 5432, not the 6543 transaction pooler)
R2_* (same) · GEMINI_API_KEY (service-account AUTH key) · GEMINI_ANALYZE_MODEL
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET   # Drive access-token refresh only (ADR 0025)
TOKEN_ENC_KEY                        # same value as Vercel — decrypts the stored refresh tokens
WORKER_ID
optional: MAX_IMPORT_BYTES (default 200 MB) · WORKER_POOL_MAX (3) · POLL_MS (2000) · ANALYZE_ON_INGEST
```
**Dropbox needs no worker credentials** — the Chooser direct link IS the credential and it rides in the job payload (ADR 0008). There is no `GEMINI_CONCURRENCY` (nothing runs Gemini in parallel — see §7).

- **Gemini credentials:** use a **service-account-bound AUTH key** (not a standard API key) for `GEMINI_API_KEY` on both web and worker — scopes access to the billing project and keeps user photos off the free tier. Billing enabled from day 1 (Tier 1+).
- Environments: `dev` (local supabase or separate project) + `prod`. Migrations: Supabase CLI, applied by the **single migrations owner**, PR-gated.
- CI (GitHub Actions): one required `checks` job running `lint typecheck test build` (a red test blocks merge exactly like a type error), plus the required `db-tests` pgTAP job, which fast-skips unless `supabase/**` or the worker's SQL-bearing files change (ADR 0020).

---

## 12. Security & privacy checklist

- RLS on all tables (§5); `viewer` role read-only enforced in policies.
- Publication tables are stricter than normal member RLS: neither `anon` nor
  `authenticated` has direct table **or resolver** privileges. A 256-bit URL
  token is stored hash-only; three service-role-only SECURITY DEFINER resolvers
  run inside a fenced server integration and match only `ready`, unexpired,
  unrevoked rows. The integration keeps the internal key and streams the object
  through a same-origin route, so no R2 URL is issued to the browser and the
  token is re-checked for every picture and file rather than once per page
  render. Public pages never expose tenant / board / real asset ids, generation
  briefs, source metadata or R2 URLs, and are
  noindex/noarchive/no-store/no-referrer (ADR 0046).
- Encrypted OAuth tokens; short-TTL presigned URLs (15 min PUT / 1 h GET). **No long-lived export URL exists:** the worker stores only the R2 key and `GET /api/exports` presigns it per request — a 7-day URL parked in `ai_jobs.payload` was readable by every workspace member and broadcast to all of them on update.
- Auth surface (ADR 0021): post-auth `?next=` targets are validated to a same-origin
  absolute path (`lib/safe-redirect.ts`) — no open redirect off the trusted callback.
  Failures reach `/login` as a **reason code only**; the provider's `error_description`
  is never forwarded or rendered, so no attacker-authored sentence can speak in the
  app's voice on the credential page. Both guards are load-bearing — don't relax them.
- Narrow scopes only (`drive.file`, Dropbox Chooser) — no CASA in MVP.
- Attribute-level people recognition only; no face-ID, no identity persistence. Face grouping = post-MVP, opt-in, consent-gated.
- Product policy stated in UI + ToS: user data is never used to train models.
- `usage_events` doubles as AI-action audit trail (who ran what, when, on how many files).
  Since ADR 0037 every write goes through one helper (`apps/worker/src/services/usage.ts`)
  that also fills `cost_usd`, and `ingest` finally writes a row too — so the trail covers
  storage growth, not just model calls. The Usage & Storage view reads it through
  `workspace_usage()`, which is SECURITY INVOKER: RLS, not the `ws` parameter, is what
  stops one workspace reading another's numbers.
- Deletion — **shipped 2026-07-23 (ADR 0033):** user delete → `status='deleted'` + `deleted_at` (trigger-stamped) = a **30-day trash** with undo/Restore; `sweep_deleted_assets()` then enqueues a `purge` job that deletes the R2 bytes (original + previews + edited previews) and the DB derivatives, keeping the assets row as a dedup tombstone (`purged_at`, hash/key cleared — ADR 0032 revival stays safe). "Delete permanently"/"Empty trash" purge early. Source file deleted upstream → on fetch failure mark `source_missing`, **keep derivatives** (captions/tags/embeddings survive — archive value; never purged).
- Deletion — **shipped 2026-07-23 (ADR 0033):** user delete → `status='deleted'` + `deleted_at` (trigger-stamped) = a **30-day trash** with undo/Restore; `sweep_deleted_assets()` then enqueues a `purge` job that deletes the R2 bytes (original + previews + edited previews), every export artifact the photo was rendered into (a PDF embeds a JPEG of it — leaving that behind is not erasure), and the DB derivatives, keeping the assets row as a dedup tombstone (`purged_at`, hash/key cleared — ADR 0032 revival stays safe). "Delete permanently"/"Empty trash" purge early. Source file deleted upstream → on fetch failure mark `source_missing`, **keep derivatives** (captions/tags/embeddings survive — archive value; never purged).
- Project retention: archive (`archived_at`) is reversible and open-ended; trash (`deleted_at`) is a **30-day grace period**, after which `sweep_trashed_projects()` hard-deletes the project on the worker's schedule (§7). The UI states the window, so it must stay enforced. Only the project dies — its assets are workspace-global and survive (rule 9), so no R2 purge is involved. ADR 0019.
- Privacy Policy + ToS before first external user (GDPR-aware: data location EU where possible — Supabase EU region, R2 EU jurisdiction).

---

## 13. Out of MVP (explicit)

Live Drive/Dropbox sync (broad scopes + CASA) · **Drive folder sync** (`drive.readonly` + CASA) · **Dropbox folder import / full-Dropbox OAuth** (production-review clock) · video/audio + transcription · smart event clustering (timeline = chronological by `taken_at`) · face identification / person naming · **billing & credit *enforcement*** — metering, the credit unit and the `plans` catalog shipped 2026-07-27 (ADR 0037), but `plans.enforced` is false on every row and no code path refuses work for lack of credits; payment and enforcement remain out · public-share comments/approvals/passwords/analytics/custom domains · NAS/iCloud/Lightroom connectors · similarity organize-mode server clustering (may slip to fast-follow) · OpenAPI doc generation.

**Multi-representation assets** (e.g. RAW + PSD + exports grouped as one asset) are supported by the schema (asset → many files) but the MVP UI treats most assets as single-representation; the multi-rep management UI is post-MVP.

---

## 14. Open verification (2026-07-03 spikes resolved — folded into the sections above)

§14.1–14.3 / 14.6 are **resolved** and now live in §5–§9 (Picker multi-file under `drive.file`; `gemini-embedding-2` GA + one-`Content` shape; `gemini-3.1-flash-lite` via `generateContent`; Dropbox Chooser direct links). Remaining:

1. **HEIC throughput (Phase 1 QA):** `heic-decode` → sharp on real iPhone HEIC batches — confirm the 1–2 decode-concurrency cap holds memory/latency; escape hatch = custom libvips build.
2. **RAW preview coverage (Phase 1 QA):** run the `exiftool-vendored` cascade on real NEF/CR2/ARW samples from target users (ARW ~1616×1080 ceiling expected).
3. **Analyze model + API (Phase 2 re-verify):** confirm `gemini-3.1-flash-lite` id/price and the `generateContent` + `responseSchema` shape against pinned `@google/genai`; **evaluate `gemini-3.5-flash` as the newer candidate** (`gemini-3.1-flash-lite` stays the `GEMINI_ANALYZE_MODEL` default until a Phase-2 decision). See ADR 0010.

---

## 15. Build order (proposed)

Steps map 1:1 to `PLAN.md` Phase 0–7 (canonical sequencer). This is the summary; `PLAN.md` §2 carries the detailed per-phase checklists.

- **Phase 0** — Monorepo restructure (mockup → `apps/web`) + Supabase project + migration 0001 (full §4 schema) + RLS + auth flow. Deploy checkpoint (web on Vercel talking to Supabase).
- **Phase 1** — Upload path end-to-end: presign → R2 → complete → ingest job → worker skeleton on Railway → previews + EXIF visible in UI. Deploy checkpoint.
- **Phase 2** — Analyze pipeline: `gemini-3.1-flash-lite` + embeddings + tags/facts → drawer shows real data; Realtime progress.
- **Phase 3** — Captions (langs × styles, project prompt) + editing.
- **Phase 4** — Search (parse + vector + filters) wired into the search/chat UI.
- **Phase 5** — Projects M:N + canvas aggregates endpoint + layout persistence.
- **Phase 6** — Cloud imports: Drive (OAuth `drive.file` + Picker) and Dropbox (Chooser direct links, zero OAuth — ADR 0008).
- **Phase 7** — Export job. QA pass on dirty real archives (dirty samples: no-EXIF, HEIC/RAW, large batches).
