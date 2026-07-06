#!/usr/bin/env bash
# ArchiveMind — MVP build issues + labels + milestones (idempotent).
# Source of truth: docs/TECH_SPEC.md v1.2 + docs/PLAN.md §2.
# Domain: Asset ≠ File (assets = canonical entity; files = physical representations).
# Architecture: apps/web (Vercel) + apps/worker (Railway) + ai_jobs queue
# (FOR UPDATE SKIP LOCKED) + Realtime Broadcast progress. All heavy work
# (ingest/analyze/caption/export) runs in the worker. Safe to re-run.
set -euo pipefail

REPO="slobodskyi/archivemind"
echo "▶ Target repo: $REPO"

M1="M1 — Phase 0: authed workspace"
M2="M2 — Phase 1: upload + EXIF live"
M3="M3 — Phase 6: full journey"

# ── Labels ──────────────────────────────────────────────────────────────────
LABELS=(
  "phase:0|1d76db|Phase 0 — Foundations"
  "phase:1|1f883d|Phase 1 — Upload → ingest"
  "phase:2|5319e7|Phase 2 — Analyze"
  "phase:3|9e6a03|Phase 3 — Captions"
  "phase:4|b60205|Phase 4 — Search (= chat)"
  "phase:5|0052cc|Phase 5 — Projects + canvas + views"
  "phase:6|006b75|Phase 6 — Cloud imports"
  "phase:7|8250df|Phase 7 — Export + hardening"
  "area:infra|c5def5|Infra / tooling / deploy"
  "area:data|bfdadc|Schema, RLS, data access"
  "area:storage|f9d0c4|Uploads & R2"
  "area:worker|d4c5f9|Worker jobs (ingest/analyze/caption/export)"
  "area:ai|fef2c0|Gemini analyze / embeddings / search"
  "area:ui|bfd4f2|apps/web UI wiring"
  "area:import|c2e0c6|Drive / Dropbox import"
  "size:S|c2e0c6|Small (≈ half day)"
  "size:M|fbca04|Medium (1–2 days)"
  "size:L|eb6420|Large (3+ days)"
  "fast-follow|ededed|Post-MVP fast-follow (not an MVP gate)"
)
ensure_label() {
  local name="$1" color="$2" desc="$3" existing
  # Capture then grep (not `gh | grep -q`): grep -q closes the pipe on first
  # match → SIGPIPE on gh → pipefail flags the `if` non-zero → false negative.
  existing=$(gh label list --repo "$REPO" --limit 300 --json name --jq '.[].name')
  if grep -Fxq "$name" <<<"$existing"; then
    echo "  = label exists: $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null && echo "  + label:  $name"
  fi
}
echo "── Labels ──"
for l in "${LABELS[@]}"; do IFS='|' read -r n c d <<<"$l"; ensure_label "$n" "$c" "$d"; done

# ── Milestones (deploy gates) ────────────────────────────────────────────────
ensure_milestone() {
  local title="$1" desc="$2" existing
  existing=$(gh api "repos/$REPO/milestones?state=all" --jq '.[].title')
  if grep -Fxq "$title" <<<"$existing"; then
    echo "  = milestone exists: $title"
  else
    gh api "repos/$REPO/milestones" -f title="$title" -f description="$desc" >/dev/null && echo "  + milestone: $title"
  fi
}
echo "── Milestones ──"
ensure_milestone "$M1" "Phase 0 green: deployed web app, sign-up → empty authed workspace, full schema live, CI green. Gate before Phase 1."
ensure_milestone "$M2" "Phase 1 green: upload 500+ real files → previews & EXIF appear in the deployed UI with live progress. Gate before Phase 2."
ensure_milestone "$M3" "Phase 6 green: full journey — connect Drive, pick files, they ingest, analyze, and are searchable. Gate before Phase 7."

# ── Issues ──────────────────────────────────────────────────────────────────
create_issue() {
  local title="$1" body="$2" labels="$3" milestone="${4:-}" existing
  existing=$(gh issue list --repo "$REPO" --state all --search "in:title \"$title\"" --json title --jq '.[].title')
  if grep -Fxq "$title" <<<"$existing"; then
    echo "  = issue exists: $title"; return
  fi
  local args=(--repo "$REPO" --title "$title" --body "$body" --label "$labels")
  [ -n "$milestone" ] && args+=(--milestone "$milestone")
  gh issue create "${args[@]}" >/dev/null && echo "  + issue:  $title"
}
echo "── Issues ──"

# ═══ Phase 0 — Foundations → M1 ═══
create_issue "Monorepo restructure: mockup → apps/web (pnpm + turbo)" \
$'Move the ported mockup into a monorepo with no functional changes (spec §3, PLAN 0.1).\n\n- [ ] pnpm workspace + turborepo; root `package.json` (packageManager pin, engines), `pnpm-workspace.yaml`, `turbo.json`; delete `package-lock.json`\n- [ ] app → `apps/web` (`@/*` alias survives); `next.config.ts` `turbopack.root` + `outputFileTracingRoot`\n- [ ] scaffold `packages/shared` (zod domain types) + empty `apps/worker`\n- [ ] CI npm → pnpm/turbo; Vercel Root Directory → `apps/web`; `.gitignore` un-anchor + `.turbo/`' \
  "phase:0,area:infra,size:L" "$M1"

create_issue "Accounts & infra provisioning" \
$'Stand up all external services + env (spec §11, PLAN 0.2).\n\n- [ ] Supabase project (EU) + pgvector; Cloudflare R2 bucket + CORS (`ExposeHeaders: ["ETag"]`); Railway project\n- [ ] Google Cloud (OAuth client, Picker API key — note project **number** for `setAppId`); Dropbox app key + Chooser domain\n- [ ] Gemini **service-account AUTH key** (not a standard key) + billing enabled (Tier 1+)\n- [ ] Vercel + Railway env vars per §11, incl. `GEMINI_ANALYZE_MODEL`' \
  "phase:0,area:infra,size:M" "$M1"

create_issue "Migration 0001: FULL §4 schema (ALL tables) + RLS + Broadcast" \
$'One migration = the entire §4 schema, not just files/previews (spec §4/§5, PLAN 0.3).\n\n- [ ] tables: `assets`, `files`, `asset_previews`, `asset_exif`, `projects`, `project_assets`, `tags`, `asset_tags`, `captions`, `facts`, `embeddings`, `ai_jobs`, `usage_events`, `canvas_layouts`, `source_connections`, + identity (`profiles`/`workspaces`/`memberships`)\n- [ ] `ai_jobs` **Broadcast trigger** (`realtime.broadcast_changes()`); dedup unique `(workspace_id, content_hash)` on files\n- [ ] RLS: `is_member/is_owner/is_editor` + `is_member_of_asset` for asset-child tables; policies on every table\n- [ ] Supabase Auth (email + Google); `proxy.ts` guard; first-login bootstrap (profile → workspace → owner)' \
  "phase:0,area:data,size:L" "$M1"

# ═══ Phase 1 — Upload → ingest → M2 ═══
create_issue "Upload path: presign → R2 → complete + job progress" \
$'Lane W. Real uploads + the shared progress hook (spec §6/§9/§10).\n\n- [ ] `POST /api/uploads/presign` (single PUT <100 MB; fixed-size multipart above) → `POST /api/uploads/complete` (creates **asset + file**)\n- [ ] assets list via `GET /api/assets` replacing `getPhotos()` → **`getAssets()`** in `lib/api.ts`\n- [ ] `useJobProgress` hook on the Realtime **Broadcast** channel (private, per workspace)\n- [ ] per-file upload progress UI' \
  "phase:1,area:storage,size:L" "$M2"

create_issue "Worker skeleton + ai_jobs queue (Railway)" \
$'Lane K. The queue engine all heavy work runs on (spec §7).\n\n- [ ] `apps/worker` on Railway, `node:22-slim`, session-pooler pg `Pool` max 2–5 (never the 6543 transaction pooler)\n- [ ] claim loop `FOR UPDATE SKIP LOCKED`, heartbeat, retry/backoff (attempts<3), reaper (15 min), graceful shutdown\n- [ ] progress/`progress_label`/`done_items` writes → Realtime picks up\n- [ ] handler dispatch (ingest/analyze/caption/export) + idempotency by natural keys' \
  "phase:1,area:worker,size:L" "$M2"

create_issue "Ingest handler (worker)" \
$'Ingest runs on the queue, writes asset-level derivatives (spec §8.1).\n\n- [ ] stream bytes → sha256 dedup — on conflict **attach the file to the existing asset** (no new asset)\n- [ ] EXIF (`exifr`; RAW via `exiftool-vendored` v36) → `asset_exif`\n- [ ] previews via `sharp` — HEIC via `heic-decode`→`sharp({raw})` (concurrency 1–2); RAW embedded-JPEG cascade → `asset_previews` in R2\n- [ ] **PDF branch**: `pdf-parse` v2 → text + page-1 preview\n- [ ] auto-enqueue `analyze`' \
  "phase:1,area:worker,size:L" "$M2"

create_issue "Phase-1 QA: HEIC throughput + RAW coverage" \
$'Close the two open verification spikes on real files (spec §14).\n\n- [ ] HEIC throughput/memory on real iPhone batches (decode concurrency cap 1–2 holds)\n- [ ] RAW cascade coverage on real NEF/CR2/ARW samples (ARW ~1616×1080 ceiling)\n- [ ] no-EXIF files handled gracefully; 500+ mixed files → previews & EXIF with live progress' \
  "phase:1,area:worker,size:M" "$M2"

# ═══ Phase 2 — Analyze → M3 ═══
create_issue "Analyze handler (worker): Gemini + embeddings" \
$'Analyze runs in the worker (spec §8.2; ADR 0007/0010). *May split into analyze / embeddings if it gets heavy.*\n\n- [ ] medium preview → `GEMINI_ANALYZE_MODEL` (`gemini-3.1-flash-lite`) via **`generateContent` + `responseSchema`** → **`asset_tags`** / `facts` (attributes only, no identity)\n- [ ] `gemini-embedding-2`, one `Content` per image, 768 dims → `embeddings(kind=image)`\n- [ ] **`doc_chunk` embeddings for PDFs/documents** — search must cover photos AND documents\n- [ ] `usage_events` per call; concurrency cap 5 + 429 backoff; set `assets.ai_processed_at`' \
  "phase:2,area:worker,size:L" "$M3"

create_issue "Drawer on real data" \
$'Lane W. Replace mock drawer with DB reads.\n\n- [ ] tags / captions / facts / EXIF via `GET /api/assets/:id`\n- [ ] manual tag add/remove (`source=manual`); fact confirm (`PATCH /api/facts/:id`)' \
  "phase:2,area:ui,size:M" "$M3"

create_issue "Bulk-AI panel → real jobs" \
$'Lane W. Wire the bulk panel to the queue.\n\n- [ ] `POST /api/jobs` (`assetIds`) + Realtime **Broadcast** progress (replaces the fake `setInterval`)\n- [ ] real job options; accurate counts + partial-failure surfacing' \
  "phase:2,area:ui,size:M" "$M3"

# ═══ Phase 3 — Captions → M3 ═══
create_issue "Caption handler (worker)" \
$'Captions run in the worker, asset-level (spec §8.3).\n\n- [ ] per asset × lang × style; templates in `packages/shared/prompts.ts` + per-project `caption_prompt`\n- [ ] metadata-grounded (date, GPS label, confirmed facts) + medium preview\n- [ ] upsert `captions (asset_id,lang,style)`' \
  "phase:3,area:worker,size:M" "$M3"

create_issue "Caption editing + regenerate-confirm" \
$'Lane W. Real caption editing in the drawer.\n\n- [ ] `PATCH /api/captions/:id` sets `is_edited=true`\n- [ ] regenerate never silently overwrites edited captions (UI confirm)\n- [ ] drawer language/style switching backed by real rows' \
  "phase:3,area:ui,size:M" "$M3"

# ═══ Phase 4 — Search (= chat) → M3 ═══
create_issue "Search API: parse + vector + filters" \
$'Composite NL search over **photos AND documents** (spec §8.4). Route handler, not a job.\n\n- [ ] query parse via `generateContent` (structured) → `{semantic_text, dates, places, tags, kinds}`\n- [ ] embed query → pgvector cosine (HNSW) over `embeddings` (image + `doc_chunk`) scoped to workspace/project\n- [ ] metadata joins: `asset_exif.taken_at`, `gps_label`/place-tags with **no-GPS fallback**, `asset_tags` boost\n- [ ] top-N assets + matched-filter explanation; log `search_query` usage' \
  "phase:4,area:ai,size:L" "$M3"

create_issue "Chat panel shows Smart Search results (no separate chat)" \
$'AI chat = search. No standalone conversational Gemini (spec §10 mapping).\n\n- [ ] chat panel renders `GET /api/search` results instead of canned replies\n- [ ] `lib/chat.ts` (canned-LLM surface) retires\n- [ ] show *why* each result matched (metadata + semantic)' \
  "phase:4,area:ui,size:M" "$M3"

# ═══ Phase 5 — Projects + canvas + views → M3 ═══
create_issue "Projects CRUD + M:N membership" \
$'Curated subsets over workspace-global assets (spec §9).\n\n- [ ] `POST/GET/PATCH /api/projects` (incl. `caption_prompt`)\n- [ ] `POST/DELETE /api/projects/:id/assets` (**`project_assets`** M:N)\n- [ ] add-to-project from selection/search (replaces in-memory `addToProject`)' \
  "phase:5,area:data,size:M" "$M3"

create_issue "Neural view on live canvas aggregates (virtualize)" \
$'MVP view. The riskiest frontend task — 10k–30k real assets vs 235 mock (spec §10).\n\n- [ ] `GET /api/canvas` aggregates (sources → folders → counts + first-K previews)\n- [ ] materialize tiles only for expanded folders / viewport; cap ~300 mounted; virtualize\n- [ ] spike early with ~20k synthetic rows' \
  "phase:5,area:ui,size:L" "$M3"

create_issue "Timeline view on real taken_at" \
$'MVP view. Chronological, real dates.\n\n- [ ] bucket by `asset_exif.taken_at` (replaces `hash(id)%6`)\n- [ ] per-asset EXIF + titles (replaces identical mock block)\n- [ ] empty/loading states' \
  "phase:5,area:ui,size:M" "$M3"

create_issue "Map view on live data" \
$'Fast-follow. Depends on GPS, which pro cameras often lack.\n\n- [ ] markers from `asset_exif` GPS\n- [ ] **no-GPS fallback** — location from place-tags/caption; UI notes "location from tags"\n- [ ] not an MVP gate' \
  "phase:5,area:ui,size:M,fast-follow" "$M3"

create_issue "Sense view on live data" \
$'Fast-follow. Thematic clustering.\n\n- [ ] cluster by real tags / groups; empty/loading states\n- [ ] not an MVP gate' \
  "phase:5,area:ui,size:M,fast-follow" "$M3"

create_issue "Canvas layout persistence + organize modes + undo/redo" \
$'Persist canvas interactions + journey requirements (spec §10, §4 canvas_layouts).\n\n- [ ] `PUT /api/canvas/layout` (`overrides` keyed by asset id, `organize_mode`)\n- [ ] organize `source | date | place` (similarity post-MVP)\n- [ ] client-side **undo/redo** for drags (new work — not in the mockup)' \
  "phase:5,area:ui,size:L" "$M3"

# ═══ Phase 6 — Cloud imports → M3 ═══
create_issue "Google Drive import (OAuth + Picker)" \
$'Drive via `drive.file` + Picker (spec §9; amendment A5).\n\n- [ ] OAuth `drive.file` + token encryption (AES-GCM, `TOKEN_ENC_KEY`)\n- [ ] Picker **multi-file** (MIME-filtered `DocsView`, `MULTISELECT`, `LIST` mode, `setAppId`=project number; folders = navigation only)\n- [ ] `POST /api/imports` → **asset + file** rows → ingest (worker streams `files.get?alt=media`)' \
  "phase:6,area:import,size:L" "$M3"

create_issue "Dropbox import (Chooser, zero OAuth → R2)" \
$'Dropbox via Chooser direct links, no OAuth (spec §6/§9; ADR 0008).\n\n- [ ] Chooser `linkType:"direct"`, `multiselect`, `extensions:["images"]`\n- [ ] `POST /api/imports` → **asset + file** rows → worker streams bytes within the 4 h window → **store original in R2**\n- [ ] 429/`Retry-After` + stale-link (410) handling' \
  "phase:6,area:import,size:M" "$M3"

# ═══ Phase 7 — Export + hardening (post-M3) ═══
create_issue "Export job (worker): ZIP + captions.csv" \
$'Export in the worker (spec §8.5).\n\n- [ ] `type=export` (payload `asset_ids`): ZIP (owned original files where present, else medium previews + note) + `captions.csv` sidecar (asset title, lang, style, text, tags, facts, EXIF)\n- [ ] → R2 `exports/{job_id}.zip` → presigned GET (7 d) in `ai_jobs.payload.result_url`; `export` usage_event' \
  "phase:7,area:worker,size:M"

create_issue "Deletion flows (soft-delete + R2 purge)" \
$'Deletion + source-missing handling (spec §12).\n\n- [ ] asset delete → `assets.status=deleted` + background purge of R2 derivatives\n- [ ] upstream source gone → on fetch failure mark `source_missing`, **keep derivatives** (captions/tags/embeddings survive)' \
  "phase:7,area:data,size:M"

create_issue "Security & privacy pass + Privacy Policy/ToS" \
$'Pre-launch security review (spec §12).\n\n- [ ] RLS audit on every table; `viewer` read-only; encrypted OAuth tokens\n- [ ] presigned TTLs (15 min PUT / 1 h GET / 7 d export); attribute-only recognition (no face-ID)\n- [ ] `usage_events` audit trail; Privacy Policy + ToS before first external user (GDPR/EU)' \
  "phase:7,area:infra,size:M"

create_issue "Final QA on a real dirty archive" \
$'End-to-end journey on real messy data.\n\n- [ ] sign in → import (upload + Drive + Dropbox) → ingest → analyze → caption → search → export\n- [ ] dirty samples: HEIC/RAW, no-EXIF, large batches; all milestones green' \
  "phase:7,area:worker,size:S"

# ═══ Cross-cutting (fast-follow) ═══
create_issue "Minimal workspace invite (owner adds member by email)" \
$'Teams are in the schema (memberships) but the MVP has no invite UI. Minimal path (spec §4/§5).\n\n- [ ] owner adds an existing user to the workspace by email → `memberships` row (role editor)\n- [ ] invitee sees the shared workspace (RLS already scopes by membership)\n- [ ] full invite/email flow is post-MVP' \
  "area:data,size:S,fast-follow"

# ═══ Setup-audit gaps (2026-07-06) — see PLAN §4 ═══
create_issue "Test strategy + CI wiring" \
$'CI today is lint + typecheck + build only (spec §11) — no automated tests. Decide the approach and wire it in before shipping upload → ingest → RLS (PLAN §4).\n\n- [ ] decide test layers: worker handler unit tests, RLS policy tests, API contract tests (zod from `packages/shared`)\n- [ ] add to the CI `checks` job (`turbo run test`)\n- [ ] this is a decision to make, not a default — capture the choice in an ADR' \
  "phase:0,area:infra,size:M" "$M1"

create_issue "Decide dev vs prod environments" \
$'Spec §11 leaves local-vs-separate-project as an open "or"; issue #4 provisions one instance of each service. Decide and provision explicitly (PLAN §4).\n\n- [ ] pick dev DB story (local Supabase vs a separate `dev` project) + a `prod` project\n- [ ] mirror R2 buckets / Railway envs per environment\n- [ ] document the split so migrations owner knows where each lands' \
  "phase:0,area:infra,size:S" "$M1"

create_issue "Source real sample corpora for QA" \
$'M2 and the Phase-1/Phase-7 QA issues all gate on real dirty files, but gathering them is unowned (PLAN §4). Blocks a milestone if left late.\n\n- [ ] 500+ mixed real files; real-iPhone HEIC batches; NEF/CR2/ARW from target cameras; no-EXIF samples\n- [ ] store somewhere both devs can reach (not in git)\n- [ ] feeds #9 (HEIC/RAW QA) and #28 (final dirty-archive QA)' \
  "phase:1,area:worker,size:S" "$M2"

create_issue "Clean the lib/api.ts seam-leak sites" \
$'Five modules import `lib/mock-data.ts` directly, bypassing the `lib/api.ts` seam (ADR 0002 known-debt; PLAN §4). Clean as their features go real in Phase 1.\n\n- [ ] `lib/format.ts`, `lib/layout.ts`, `hooks/useWorkspace.ts`, `components/map/MapCanvas.tsx`, `components/toolbar/AddToProjectPopover.tsx`\n- [ ] route their lookups through `lib/api.ts`\n- [ ] add a lint guard against new direct `mock-data` imports outside `lib/api.ts`' \
  "phase:1,area:ui,size:S" "$M2"

create_issue "Phase-2 analyze-model re-verify" \
$'Spec §14 item 3 / PLAN §3+§4. Gemini surface moves fast; confirm before building the analyze handler. Issue #9 covers only HEIC/RAW QA, so this had no home.\n\n- [ ] confirm `gemini-3.1-flash-lite` id + price + `generateContent`/`responseSchema` shape against pinned `@google/genai`\n- [ ] evaluate `gemini-3.5-flash` as the newer candidate\n- [ ] update `GEMINI_ANALYZE_MODEL` default + ADR 0010 with the decision' \
  "phase:2,area:ai,size:S" "$M3"

echo "✓ Done."
