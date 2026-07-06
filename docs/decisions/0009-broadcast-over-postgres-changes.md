# 0009. Realtime job progress via Broadcast from Database

Date: 2026-07-06

Status: Accepted

## Context

`ai_jobs` progress must reach the browser live. `postgres_changes` works but shares a
single WAL reader and re-checks RLS per subscriber; Supabase now recommends **Broadcast
from Database** for this pattern — same implementation effort, better scaling.

## Decision

An `AFTER UPDATE` trigger on `ai_jobs` calls `realtime.broadcast_changes()` (ships in
migration 0001). Clients join a **private** channel per `workspace_id` with `setAuth()`,
authorized by an RLS policy on `realtime.messages`.

## Consequences

- Progress fan-out is decoupled from the WAL reader → scales past `postgres_changes`.
- The trigger + `realtime.messages` RLS policy are part of the schema (migration 0001),
  not app wiring.

Stub — expand at Phase 0 (migration 0001 + Realtime).
