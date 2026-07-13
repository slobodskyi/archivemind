# 0014. Projects are the primary navigation scope

Date: 2026-07-13

Status: Accepted

## Context

The canvas header inherited an `All my files / Project` breadcrumb from the
source mockup. Once real projects and project-scoped uploads shipped, that
hierarchy became misleading: a project is not a child folder of an `All my
files` canvas, and switching projects should not require navigating through a
workspace-wide source browser.

The workspace-global asset scope remains part of the canonical domain model.
It is required for deduplication, assets without project membership, M:N
project membership, and future workspace-wide search. The question here is
how that scope participates in navigation, not whether it exists in storage.

## Decision

- The homepage is the project hub: users create and open projects there.
- An open project's header shows only the current project name. Its dropdown
  switches directly among projects; `All my files` is not a breadcrumb parent
  or a project-switcher entry.
- The home icon returns to the project hub.
- The workspace-global asset scope stays available to the data/API layer. A
  future library surface may expose it as a secondary grid on the homepage,
  without making it the root of project navigation.

## Consequences

This supersedes only the two-part header breadcrumb described by
[0012](0012-toolbar-header-reorg.md). It does not change the `Asset ≠ File`
model, project M:N membership, or project filtering.

Uploads made inside a project must continue to link the resulting assets to
that project. Before removing any remaining global upload entry point, the UI
must either require a target project or provide a library surface for assets
without project membership. The project-canvas implementation now satisfies
this by exposing upload controls only inside an open project; the hidden legacy
grid remains available solely to recover previously unassigned assets.
