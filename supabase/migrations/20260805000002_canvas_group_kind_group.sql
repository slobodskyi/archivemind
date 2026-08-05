-- Bound tile groups become the third canvas_group kind (ADR 0034 amended).
--
-- PR #184 split "Group" off from folders: Group binds a selection into a set
-- that selects, moves and edits as one, with no container drawn around it. It
-- shipped as `tileGroups: string[][]` inside the localStorage canvas
-- arrangement, which made it per-browser — a group built on a laptop simply did
-- not exist on a phone, and no teammate ever saw it.
--
-- That was the wrong side of ADR 0034's line. The line is not "folders are
-- server, everything else is local" — it is **membership is data, geometry is a
-- per-user client override**. Which files belong together is a statement about
-- the archive, exactly like which files are in a folder or on an artboard;
-- where the resulting tiles happen to sit is not. A bound group is pure
-- membership with no geometry of its own at all, so it belongs here entirely.
--
-- Nothing else moves: tile positions, frames, sticky notes and the layer-order
-- deltas stay in localStorage. ADR 0022 stands.
--
-- Reusing the existing table rather than adding one gets the RLS policies, the
-- cascade behaviour, the three routes and the read seam for free; `settings`
-- stays '{}' as it does for folders, and `sort_index` is unused but harmless.
alter type canvas_group_kind add value if not exists 'group';

comment on type canvas_group_kind is
  'folder — collapses N tiles into one labelled tile; artboard — ordered members become PDF pages; group — a bound set that selects/moves/edits as one, no container. All three are membership only: geometry stays a per-user localStorage override (ADR 0022).';
