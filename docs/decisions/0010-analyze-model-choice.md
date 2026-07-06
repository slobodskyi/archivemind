# 0010. Analyze/caption model = gemini-3.1-flash-lite (env-pinned)

Date: 2026-07-06

Status: Accepted

## Context

The spec originally named `gemini-2.5-flash-lite`; the 2.x-gen Flash-Lite line is
sunsetting (2.0 already shut down 06/2026). The current GA option is
**`gemini-3.1-flash-lite`** (~$0.31–0.35 / 1000 images at $0.25/M in, $1.50/M out;
EN/UK/RU; structured output via `generateContent` — see ADR 0007). Gemini's model line
moves fast.

## Decision

Default **`GEMINI_ANALYZE_MODEL=gemini-3.1-flash-lite`**; expose `media_resolution` as a
per-call option (medium for tags, high when OCR matters). The id lives in env so it can
change without code edits.

## Consequences

- Re-verify at Phase 2, and **evaluate `gemini-3.5-flash` as the newer candidate** then;
  `gemini-3.1-flash-lite` stays the default until a Phase-2 decision.
- Embeddings are a separate decision: `gemini-embedding-2` @ 768 dims, **no fallback**
  (`gemini-embedding-001` retires 2026-07-14, incompatible vector space).

Stub — expand at Phase 2 (analyze pipeline).
