# 0007. AI seam uses generateContent, not the Interactions API

Date: 2026-07-06

Status: Accepted

## Context

Gemini's newer Interactions API is positioned as the primary surface (`generateContent`
is labelled "Legacy" in some docs). But our AI calls — analyze, caption, and
search-query parse — are **single-shot** with no multi-turn conversational state, and
bulk ingest of large archives depends on the **Batch API**, which is not yet available
on the Interactions surface.

## Decision

Write the AI seam against **`generateContent` + `responseSchema`** (structured JSON) via
a pinned `@google/genai`. Keep the analyze model id in `GEMINI_ANALYZE_MODEL`.

## Consequences

- One code path serves interactive and (later) Batch calls — no rewrite when batching lands.
- No dependency on an API surface that lacks the Batch primitive we need.
- Re-verify the `generateContent` / `responseSchema` shape at Phase 2 (the API is moving
  fast); revisit Interactions if/when it gains Batch and our volumes justify it.

Stub — expand when the AI seam is built (Phase 2).
