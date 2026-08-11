# 0043 — Upload completion is atomic and idempotent

## Status

Accepted — 2026-08-11.

## Context

A local upload has two independent halves. The browser first puts each binary
directly into R2 through a presigned URL, then `/api/uploads/complete` creates
the corresponding assets, files, optional project memberships and ingest job
in Postgres.

The original completion route performed those database writes as separate
PostgREST requests. A late failure could therefore leave only some rows
committed. A lost HTTP response was worse: the browser could not tell whether
the request had committed, but retrying it would create a second set of assets
and jobs. Larger batches amplified both failure modes and delayed ingestion
until every binary in the selection had transferred.

The user-facing upload batch id cannot be the idempotency key. A manual retry
keeps that batch id so optimistic canvas tiles can be reconciled in place, but
contains only the failed subset and may therefore have a different payload.

## Decision

### Transfer and completion use bounded chunks

One picker or drop action may accept up to 500 files. The client transfers and
completes them in sequential chunks of at most 100, with at most three R2 PUTs
running at once. A completed chunk can enter ingestion before the next chunk
starts, and closing the tab cannot orphan every already-transferred file in a
large selection.

Presign and R2 PUT operations have bounded timeouts and retry transient
failures. Project membership is part of completion, before the ingest job is
visible to the worker, so workspace-wide deduplication cannot race a later
project-link request.

### Every exact completion request has its own identity

The client creates a fresh UUID `completionId` for each exact completion body.
Automatic retries after a timeout, network error, 408, 425, 429 or server error
reuse the same serialized body and UUID. A manual retry is a new logical
request and receives a new UUID even though its tracing batch id is unchanged.

The server returns 409 if one completion UUID is ever presented with a
different canonical JSON payload, project or actor. It never guesses which
version the caller intended.

### One database transaction owns the write boundary

`complete_upload_batch` is the only write path for local upload completion. It
is a narrow `SECURITY DEFINER` RPC that:

- resolves and authorizes the caller as a workspace editor;
- validates 1–100 upload rows, byte limits and workspace-prefixed R2 keys;
- validates the optional project in the same workspace;
- inserts ordered assets and files;
- inserts project memberships before making the ingest job visible;
- records the completion result in a private ledger; and
- returns the ordered asset ids and one job id.

All of those writes commit or roll back together. The function takes a
transaction-scoped advisory lock for `(workspace, completionId)`. A private
`upload_completions` row stores the exact canonical request, actor and result.
Replaying the same request returns those original ids without inserting any
new rows. The composite workspace key allows the same random UUID to be used in
different workspaces without coupling tenants.

The HTTP route remains the authentication, schema and error-mapping adapter;
it does not reproduce the transaction in application code. The RPC is granted
only to authenticated callers and still performs its own membership check.

## Consequences

- A lost completion response is safe to retry and a late database failure no
  longer leaves active placeholder assets without a job.
- The ingest worker can start after each 100-file chunk instead of waiting for
  an entire 500-file selection.
- The ledger consumes a small row per completed chunk. Retention can be added
  later, but must exceed every possible client retry window.
- R2 objects can still be orphaned if the browser disappears after PUT and
  before any completion request reaches Postgres. Cleaning such objects is a
  separate storage-reconciliation concern; it is not made ambiguous by a
  partial database commit anymore.
- The user-visible batch id remains useful for tracing and optimistic UI, but
  is deliberately not a database idempotency key.
- pgTAP tests pin authorization, exact replay, payload conflicts, ordering,
  project-before-job visibility and rollback after a deliberately late error.
