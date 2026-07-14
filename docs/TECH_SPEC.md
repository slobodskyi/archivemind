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
6. Review in drawer (captions, tags, EXIF, facts) → confirm facts → export selection (ZIP + CSV sidecar).

**Import model:** snapshot import (no live sync). Google Drive originals stay in the source (worker streams the bytes at processing time); Dropbox originals and local uploads are stored in full in R2 (Dropbox direct links can't be re-fetched — ADR 0008). We always keep derivatives (previews, EXIF, tags, captions, embeddings). "Add more files" = re-open picker.

---

## 2. Architecture overview

```
Browser (Next.js on Vercel)
  │  supabase-js (anon key + RLS)          ── auth, reads, Realtime job progress
  │  Route handlers (/api/*)               ── presign R2 uploads, OAuth, enqueue jobs, search
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
| 11 | No enforced usage limits in MVP, but **every AI action logged** in `usage_events` | Data for the future credits model from day 1. |
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
│       │   ├── retention.ts        # periodic sweeps (trashed-project purge, §7)
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
                                     -- pdf_processed | search_query | export
  units int not null default 1,
  model text,
  cost_usd numeric(10,6),
  created_at timestamptz default now()
);
create index usage_ws_idx on usage_events (workspace_id, created_at);

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
{workspace_id}/originals/{file_id}/{filename}     -- per FILE (physical); uploads AND Dropbox
{workspace_id}/previews/{asset_id}/thumb.webp     -- per ASSET; 256px long edge
{workspace_id}/previews/{asset_id}/medium.webp    -- per ASSET; 1024px long edge
{workspace_id}/exports/{job_id}.zip               -- export bundles (presigned GET, cleanup later)
```

- Uploads: browser → `POST /api/uploads/presign` → presigned PUT direct to R2 → `POST /api/uploads/complete`. Multipart (>100 MB) uses a **fixed chunk size (~50 MiB; all parts equal except the last)**; bucket CORS must set `ExposeHeaders: ["ETag"]` (else the browser can't complete multipart); no unsigned headers on part PUTs; no POST-policy uploads (unsupported on R2). Max presigned TTL 7 days.
- Cloud-linked files (**Drive only**): originals never copied; worker streams bytes at processing time (Drive `files.get?alt=media`), keeps only previews + derived data. **Dropbox** (Chooser direct links, 4 h TTL) is fetched once at ingest and its original is stored in R2 like an upload — the link can't be refreshed later (ADR 0008).
- All preview serving via presigned GET or public bucket + Cloudflare CDN — zero egress cost either way.

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
- **Retention sweeper:** on boot, then every 6 h, `select sweep_trashed_projects()` — hard-deletes projects past the 30-day trash window (§12). Not an `ai_jobs` type: it's neither user-triggered nor per-asset. Failures are logged and retried on the next tick. See ADR 0019.
- **Idempotency:** handlers upsert by natural keys (`asset_previews` PK, `captions (asset_id,lang,style)`, `embeddings (asset_id,kind,chunk_index)`) — safe to re-run.
- **Rate limiting:** worker-side concurrency cap on Gemini calls (start: 5 parallel) + exponential backoff on 429.
- Graceful shutdown: finish current item, release job back to `queued`.

---

## 8. AI pipeline

### 8.1 Ingest (`type='ingest'`, payload: asset_ids)
Per file: stream bytes → sha256 (dedup check) → EXIF (`exifr`; for RAW use `exiftool-vendored`) → decode:
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

### 8.3 Captions (`type='caption'`, payload: asset_ids, langs[], style)
Per asset × lang: prompt = base template (in `packages/shared/prompts.ts`, per style) + `projects.caption_prompt` (if run in project context) + known metadata (date, GPS label, confirmed facts) + medium preview → text → upsert `captions`. Editing a caption in UI sets `is_edited=true`; regenerate never silently overwrites edited captions (UI confirms).

### 8.4 Search (route handler, not a job)
1. `GEMINI_ANALYZE_MODEL` parses the query (structured output via `generateContent`) → `{semantic_text, date_from?, date_to?, place_terms[], tag_terms[], kinds[]}`.
2. Embed `semantic_text` (same model/space as documents; Embedding 2 → embed query text into the multimodal space).
3. SQL: cosine similarity over `embeddings` scoped to workspace (+ project filter), joined with metadata filters:
   - dates → `asset_exif.taken_at` range;
   - places → match `gps_label ILIKE` any place_term OR the asset has a `place`-category tag matching;
   - tags → boost/filter via `asset_tags`.
4. Return top-N assets with similarity + matched-filter explanation (UI shows *why* it matched).
Graceful degradation: no GPS in archive (common for pro cameras) → place matching falls back to tags/caption text; note in UI ("location from tags").
Log `search_query` usage_event. Latency budget: 1 analyze-model call + 1 embed + 1 SQL ≈ well under Vercel limits.

### 8.5 Export (`type='export'`)
Payload: asset_ids, langs, style. Worker builds ZIP (owned original files where present, else medium previews + note) + `captions.csv` (asset title, lang, style, text, tags, facts, EXIF) → R2 `exports/` → presigned GET (7 days) in `ai_jobs.payload.result_url`.

### Cost notes (recorded per event; re-verify current prices at Phase 2)
- `gemini-3.1-flash-lite` analyze/caption: ≈ $0.31–0.35 per 1000 images ($0.25/M in, $1.50/M out; ~half at `media_resolution=medium`, ~half again via Batch API).
- Embedding 2: $0.00012/image interactive, $0.00006 batch (≈ $0.60 / 10k photos batched); text $0.20/M ($0.10 batch).
- **Never use the free Gemini tier for user photos** — it trains on user data. Billing enabled from day 1; interactive API is fine for MVP volumes, Batch API for large bulk-ingest later.
- R2: $0.015/GB-mo storage, zero egress. Supabase Pro $25/mo.

---

## 9. API surface (Next.js route handlers)

All routes authed (Supabase session); workspace derived from membership.

| Method & path | Purpose |
|---|---|
| `POST /api/uploads/presign` | `{filename,mime,size}` → `{uploadUrl, r2Key}` (fixed-size multipart >100 MB; server orchestrates Create/Complete; CORS `ExposeHeaders:[ETag]`) |
| `POST /api/uploads/complete` | after PUT: create `assets` + `files` row(s) → enqueue `ingest` |
| `GET  /api/assets` | list (workspace or `?projectId=`), cursor-paginated, incl. preview URLs |
| `GET  /api/assets/:id` | asset + files + exif + tags + captions + facts |
| `PATCH /api/assets/:id` | rename (title), status |
| `DELETE /api/assets/:id` | **shipped** — soft delete (`status='deleted'`, §12). Callable from any canvas view. Note this overlaps the status half of the PATCH row above; the two want reconciling. |
| `GET  /api/canvas?projectId=` | aggregates for neural view (workspace-wide, or scoped to a project — matches the `canvas_layouts.scope` = `'all'` \| project uuid): sources → folders → counts + first-K tile previews (lazy-load the rest) |
| `PUT  /api/canvas/layout` | persist `canvas_layouts` (scope, overrides, organize_mode) |
| `GET/POST /api/sources/:provider/oauth` | OAuth start + callback; store encrypted tokens |
| `POST /api/imports` | `{provider, items:[…]}` from Picker (Drive, multi-file) or Chooser (Dropbox, direct links) → `assets` + `files` rows → `ingest` job (worker streams Drive bytes; fetches Dropbox bytes once → R2) |
| `POST /api/projects` · `GET /api/projects` · `PATCH /api/projects/:id` | CRUD incl. `caption_prompt`. **Shipped:** `GET` takes `?scope=active\|archived\|trash`; `PATCH` does rename **and** archive/trash (`{name}` / `{archived}` / `{deleted}` → `archived_at`/`deleted_at`, ADR 0019). `caption_prompt` is not wired yet (Phase 3). |
| `POST /api/projects/:id/assets` · `DELETE .../assets/:assetId` | M:N add/remove |
| `POST /api/jobs` | `{type:'analyze'|'caption'|'export', assetIds|projectId, options}` → insert `ai_jobs` |
| `GET  /api/jobs/:id` | status (primary channel is Realtime; this is fallback) |
| `GET  /api/search?q=&projectId=` | §8.4 |
| `PATCH /api/captions/:id` | edit text (`is_edited=true`) |
| `POST /api/assets/:id/tags` · `DELETE` | manual tags (`source='manual'`) |
| `PATCH /api/facts/:id` | confirm / set status |

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

**Canvas at scale (mandatory):** the mockup renders 235 nodes; real archives are 10k–30k. Neural view must consume `GET /api/canvas` aggregates — render hubs/folders with counts, materialize individual tiles only for expanded folders / current viewport, cap simultaneously-mounted tiles (~300) and virtualize. "Organize" modes (`source|date|place|similarity`) recluster client-side from aggregate data; `similarity` uses server-provided cluster ids (post-MVP: k-means over embeddings; MVP may ship `source|date|place` only).

**Mockup quirks to replace with real data:** timeline bucketing by `hash(id)%6` → real `asset_exif.taken_at`; identical EXIF block → real per-asset EXIF; cosmetic bulk toggles → real job options; no-op Regenerate → real caption job. The mockup `Photo` type becomes `Asset`.

---

## 11. Environments & deploy

**Vercel (`apps/web`)** — turborepo root, project dir `apps/web`:
```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY            # server-only routes
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_PICKER_API_KEY
DROPBOX_APP_KEY / DROPBOX_APP_SECRET
GEMINI_API_KEY                       # search-time parse + query embedding — service-account AUTH key, not a standard API key (see note below)
GEMINI_ANALYZE_MODEL                 # default gemini-3.1-flash-lite (see §8.2, ADR 0010)
TOKEN_ENC_KEY                        # if app-level token encryption
```

**Railway (`apps/worker`)** — Dockerfile `node:22-slim` (`perl-base` suffices for ExifTool; add `poppler-utils` only if `pdf-parse` v2 falls short):
```
DATABASE_URL                         # Supabase SESSION POOLER (not direct 5432, not the 6543 transaction pooler)
R2_* (same) · GEMINI_API_KEY (service-account AUTH key) · GEMINI_ANALYZE_MODEL · GOOGLE_CLIENT_ID/SECRET · DROPBOX_APP_KEY/SECRET
TOKEN_ENC_KEY · WORKER_ID · GEMINI_CONCURRENCY=5
```

- **Gemini credentials:** use a **service-account-bound AUTH key** (not a standard API key) for `GEMINI_API_KEY` on both web and worker — scopes access to the billing project and keeps user photos off the free tier. Billing enabled from day 1 (Tier 1+).
- Environments: `dev` (local supabase or separate project) + `prod`. Migrations: Supabase CLI, applied by the **single migrations owner**, PR-gated.
- CI (GitHub Actions): lint + typecheck + build on PR (per existing team playbook: trunk-based, squash-merge, verification-gated).

---

## 12. Security & privacy checklist

- RLS on all tables (§5); `viewer` role read-only enforced in policies.
- Encrypted OAuth tokens; short-TTL presigned URLs (15 min PUT / 1 h GET; 7 d exports).
- Narrow scopes only (`drive.file`, Dropbox Chooser) — no CASA in MVP.
- Attribute-level people recognition only; no face-ID, no identity persistence. Face grouping = post-MVP, opt-in, consent-gated.
- Product policy stated in UI + ToS: user data is never used to train models.
- `usage_events` doubles as AI-action audit trail (who ran what, when, on how many files).
- Deletion: user delete → `status='deleted'` + purge R2 derivatives (background); source file deleted upstream → on fetch failure mark `source_missing`, **keep derivatives** (captions/tags/embeddings survive — archive value).
- Project retention: archive (`archived_at`) is reversible and open-ended; trash (`deleted_at`) is a **30-day grace period**, after which `sweep_trashed_projects()` hard-deletes the project on the worker's schedule (§7). The UI states the window, so it must stay enforced. Only the project dies — its assets are workspace-global and survive (rule 9), so no R2 purge is involved. ADR 0019.
- Privacy Policy + ToS before first external user (GDPR-aware: data location EU where possible — Supabase EU region, R2 EU jurisdiction).

---

## 13. Out of MVP (explicit)

Live Drive/Dropbox sync (broad scopes + CASA) · **Drive folder sync** (`drive.readonly` + CASA) · **Dropbox folder import / full-Dropbox OAuth** (production-review clock) · video/audio + transcription · smart event clustering (timeline = chronological by `taken_at`) · face identification / person naming · billing & credit enforcement (tracking only) · public sharing links · NAS/iCloud/Lightroom connectors · similarity organize-mode server clustering (may slip to fast-follow) · OpenAPI doc generation.

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
