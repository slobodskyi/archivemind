# 0004. Single useWorkspace hook, no external state management library

Date: 2026-07-02

Status: Accepted

## Context

The app has a large amount of interconnected UI state — canvas pan/zoom, tool
selection, multi-view switching, photo selection/marquee, drag-to-reposition
overrides, the photo drawer, AI chat, several dropdowns/modals, and simulated
bulk-AI processing.

## Decision

All of this lives in one hook, `hooks/useWorkspace.ts`, built from plain
`useState`/`useReducer` plus refs for transient per-pointer-move drag state (to
avoid extra re-renders during drag). No Redux, Zustand, Jotai, or other state
library.

## Consequences

`hooks/useWorkspace.ts` is a large single file, but there are zero new
dependencies and one clear source of truth that's easy for an AI agent (or a
human) to read in one pass to understand the whole interaction model. Revisit
this if the file becomes genuinely unmanageable, or once the backend
introduces real server state — at that point consider something like React
Query *alongside* this hook for server-state caching, not as a replacement for
the client-only UI state here.
