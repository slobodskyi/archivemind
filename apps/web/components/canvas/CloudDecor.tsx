import { memo, useCallback, useEffect, useRef, useState } from "react";
import { hexA, type CloudLayout, type CloudNode } from "@/lib/layout";

/** Extra margin the blurred backdrop blob extends past each cloud's tile bbox.
 *  Topic's soft blobs get a wide margin so the cloud reads as a large, easily
 *  told-apart color field; Timeline's bands stay tighter so adjacent day columns
 *  don't bleed together. */
const BLOB_PAD_TOPIC = 96;
const BLOB_PAD_TIMELINE = 58;
/** Opacity applied to clouds/tiles that aren't the focused one (click a label). */
const DIM = 0.22;

interface CloudDecorProps {
  layout: CloudLayout;
  /** The colored clouds (blobs) render immediately with the grouping so the
   *  backdrop appears the same instant the tiles start reflowing (ADR 0024). Only
   *  the connecting lines wait for `edgesReady` — they're drawn between final
   *  tile centers, so showing them mid-glide would leave lines floating to empty
   *  space; they fade in once the tiles have settled. */
  edgesReady: boolean;
  /** When a cloud's label is clicked it becomes the focus; every other cloud
   *  (backdrop + tiles + label) fades back so it stands out. */
  focusedCloudKey: string | null;
  /** Topic-only semantic drop target. It is intentionally visual-only here;
   *  hit-testing lives in lib/topic-drag so the blurred blob never becomes an
   *  accidental membership target. */
  dropTargetKey?: string | null;
}

/** Backdrop for the grouping views (Timeline / Map / Topic): the blurred faded
 *  color cloud behind each group, the timeline date borders, and the connecting
 *  lines. Rendered *behind* the photo tiles; the labels render on top via
 *  CloudLabels. Tiles themselves are drawn by the shared ProjectAssetView so
 *  they persist (and animate) across every view (ADR 0022). */
function CloudDecor({ layout, edgesReady, focusedCloudKey, dropTargetKey = null }: CloudDecorProps) {
  const dimOf = (key: string) => (key === dropTargetKey ? 1 : focusedCloudKey && key !== focusedCloudKey ? DIM : 1);
  // Timeline's day clouds are pinned bands, so paint them more strongly than
  // Map/Topic's soft blobs — they read as the column, not a faint haze. Topic's
  // blobs are now more saturated too, so a cloud is legible by color alone.
  const isTimeline = !!layout.axis;
  const blobPad = isTimeline ? BLOB_PAD_TIMELINE : BLOB_PAD_TOPIC;
  const blobAlpha = isTimeline ? 0.52 : 0.36;
  const blobBlur = isTimeline ? 22 : 30;

  // A tile the user has dragged clear of its cloud's core (ADR 0038 keeps the
  // main blob + label anchored to the core, so it does NOT stretch to a far
  // outlier). Without this the stray tile sat on bare canvas with no way to tell
  // which cloud it came from — so each outlier gets its own color halo in the
  // cloud's color, and stays visibly part of the group wherever it's moved.
  //
  // The trigger is a small margin past the CORE bbox — NOT the blob's own wide
  // pad — so the halo appears the moment a tile leaves the group. Reusing the
  // blob pad left a dead zone: a tile dragged out of the visible color but not
  // yet `blobPad` px past the core sat with nothing under it. And because a lone
  // tile lacks the color-stacking of a dense cloud, its halo is drawn punchier
  // than the main blob: a solid plateau (not a single fading point), higher
  // alpha, tighter blur — so a dragged-out file clearly rests on its color.
  const HALO_MARGIN = 24;
  const haloAlpha = Math.min(blobAlpha + 0.16, 0.62);
  const haloBlur = Math.max(blobBlur - 10, 13);
  const cloudByKey = new Map(layout.clouds.map((c) => [c.key, c]));
  const dropTarget = dropTargetKey ? cloudByKey.get(dropTargetKey) : null;
  const outliers = Object.entries(layout.tiles).flatMap(([id, t]) => {
    const c = cloudByKey.get(layout.tileCloud[id]);
    if (!c) return [];
    const inCore =
      t.cx >= c.bx - HALO_MARGIN &&
      t.cx <= c.bx + c.bw + HALO_MARGIN &&
      t.cy >= c.by - HALO_MARGIN &&
      t.cy <= c.by + c.bh + HALO_MARGIN;
    return inCore ? [] : [{ id, cx: t.cx, cy: t.cy, r: Math.hypot(t.w, t.h) / 2 + 56, color: c.color, key: c.key }];
  });

  return (
    <>
      {/* Colored backdrop per cloud. On Map/Topic it hugs the live tile bbox; on
          Timeline it's a stronger band pinned to the date (ADR 0024). */}
      {layout.clouds.map((c) => (
        <div
          key={`blob-${c.key}`}
          style={{
            position: "absolute",
            left: c.bx - blobPad,
            top: c.by - blobPad,
            width: c.bw + blobPad * 2,
            height: c.bh + blobPad * 2,
            borderRadius: isTimeline ? 40 : "50%",
            background: `radial-gradient(closest-side, ${hexA(c.color, blobAlpha)}, ${hexA(c.color, 0)})`,
            filter: `blur(${blobBlur}px)`,
            opacity: dimOf(c.key),
            transition: "opacity .2s ease",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* A crisp core ring says "this drop changes the Topic". The ordinary
          cloud remains soft; making its full blurred blob the target would
          erase the distinction between semantic and positional dragging. */}
      {dropTarget && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: dropTarget.bx - 24,
            top: dropTarget.by - 24,
            width: dropTarget.bw + 48,
            height: dropTarget.bh + 48,
            border: `2px solid ${hexA(dropTarget.color, 0.82)}`,
            borderRadius: 24,
            background: hexA(dropTarget.color, 0.08),
            boxShadow: `0 0 0 5px ${hexA(dropTarget.color, 0.12)}, 0 0 34px ${hexA(dropTarget.color, 0.34)}`,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}

      {/* Color halo behind each dragged-away (outlier) tile — see above. */}
      {outliers.map((o) => (
        <div
          key={`halo-${o.id}`}
          style={{
            position: "absolute",
            left: o.cx - o.r,
            top: o.cy - o.r,
            width: o.r * 2,
            height: o.r * 2,
            borderRadius: "50%",
            background: `radial-gradient(closest-side, ${hexA(o.color, haloAlpha)} 0%, ${hexA(o.color, haloAlpha)} 36%, ${hexA(o.color, 0)} 100%)`,
            filter: `blur(${haloBlur}px)`,
            opacity: dimOf(o.key),
            transition: "opacity .2s ease",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* Timeline only: the horizontal date axis + a tick under each date label. */}
      {layout.axis && (
        <>
          <div
            style={{
              position: "absolute",
              left: layout.axis.x1,
              top: layout.axis.y,
              width: layout.axis.x2 - layout.axis.x1,
              height: 0,
              borderTop: "1px solid var(--bd)",
              pointerEvents: "none",
            }}
          />
          {layout.clouds.map((c) => (
            <div
              key={`tick-${c.key}`}
              style={{
                position: "absolute",
                left: c.labelX,
                top: layout.axis!.y - 4,
                width: 0,
                height: 9,
                borderLeft: `2px solid ${c.color}`,
                opacity: dimOf(c.key),
                transform: "translateX(-50%)",
                pointerEvents: "none",
              }}
            />
          ))}
        </>
      )}

      <svg style={{ position: "absolute", left: 0, top: 0, width: 1600, height: 1100, overflow: "visible", pointerEvents: "none", opacity: edgesReady ? 1 : 0, transition: "opacity .3s ease" }}>
        <defs>
          {layout.edges
            .filter((e) => e.strokeStart !== e.strokeEnd)
            .map((e) => (
              <linearGradient key={e.id} id={`cloud-grad-${e.id}`} gradientUnits="userSpaceOnUse" x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2}>
                <stop offset="0%" stopColor={e.strokeStart} />
                <stop offset="100%" stopColor={e.strokeEnd} />
              </linearGradient>
            ))}
        </defs>
        {layout.edges.map((e) => (
          <path
            key={e.id}
            d={e.d}
            stroke={e.strokeStart === e.strokeEnd ? e.strokeStart : `url(#cloud-grad-${e.id})`}
            strokeWidth={e.w}
            strokeOpacity={e.op}
            strokeLinecap="round"
            fill="none"
            // When a cloud is focused, its own same-cloud lines stay bright;
            // everything else — other clouds' lines AND every cross-cloud
            // bridge (cloudKey is undefined on bridges, including the focused
            // cloud's own) — fades only halfway, so cross-cloud connections
            // stay readable (less faded than the inactive clouds themselves).
            opacity={focusedCloudKey && e.cloudKey !== focusedCloudKey ? 0.5 : 1}
            style={{ transition: "opacity .2s ease" }}
          />
        ))}
      </svg>
    </>
  );
}

interface CloudLabelsProps {
  layout: CloudLayout;
  focusedCloudKey: string | null;
  /** Pointer-down on a label: drag it to move the whole cloud, or click (no
   *  drag) to focus it and fade the rest (ADR 0024). */
  onCloudLabelDown: (e: React.PointerEvent, cloudKey: string) => void;
  /** Double-click to rename (ADR 0038). Never supplied on Timeline, whose
   *  labels are dates. The caller decides what a rename MEANS — on Topic it
   *  PATCHes the stored cluster, on LABELS it renames the colour workspace-wide
   *  — and `canRenameCloud` decides which clouds offer it at all (a Topic cloud
   *  needs exactly one backing cluster; the "No label" cloud is not a colour and
   *  has no name to set). */
  onRenameCloud?: (cloud: CloudNode, name: string) => void;
  canRenameCloud?: (cloud: CloudNode) => boolean;
  /** Topic-only semantic drop target + the selection it will receive. */
  dropTargetKey?: string | null;
  dropCount?: number;
}

/** How long after a label press a second press still counts as a double-click. */
const RENAME_DOUBLE_CLICK_MS = 400;
/** …and how far apart, in screen px, the two presses may land. */
const RENAME_DOUBLE_CLICK_SLOP = 6;

/** The cloud group labels (date / topic), rendered *on top* of the tiles.
 *  Draggable — grab a label to move its whole cloud — clickable to focus that
 *  cloud (fades the others), and on Topic double-clickable to rename it.
 *  Shown immediately with the backdrop. */
function CloudLabelsBase({
  layout,
  focusedCloudKey,
  onCloudLabelDown,
  onRenameCloud,
  canRenameCloud,
  dropTargetKey = null,
  dropCount = 0,
}: CloudLabelsProps) {
  const [editing, setEditing] = useState<{ key: string } | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastPress = useRef<{ key: string; at: number; x: number; y: number } | null>(null);

  // `commit` closes over `draft`/`editing`, but the outside-press listener below
  // is registered once per edit — keep the latest in a ref so it never fires a
  // stale draft.
  const commit = useCallback(() => {
    if (!editing) return;
    setEditing(null);
    // The cloud can vanish under an open editor: a finishing cluster or analyze
    // job refreshes the page data, the labels change, and the key this edit was
    // opened on no longer exists. Writing anyway would PATCH a stale cluster —
    // pinning a name the user never confirmed, or 404-ing with a toast attached
    // to whatever they happened to click next.
    const cloud = layout.clouds.find((c) => c.key === editing.key);
    if (!cloud) return;
    const trimmed = draft.trim();
    // No "unchanged, skip the write" shortcut: on Topic the PATCH also sets
    // is_renamed, and pinning is the point. Confirming a machine name you like
    // is exactly how you stop the next re-cluster from relabelling it.
    if (trimmed) onRenameCloud?.(cloud, trimmed);
  }, [draft, editing, layout.clouds, onRenameCloud]);
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  // Commit when the press lands anywhere outside the input. `onBlur` alone is
  // not enough: the label and tile pointer-down handlers both call
  // preventDefault(), which suppresses the compat mousedown and therefore the
  // focus change — so clicking another cloud or a photo fires NO blur and left
  // a still-focused, still-keystroke-swallowing input behind. A capture-phase
  // pointerdown listener runs before any of those handlers and is not affected
  // by their preventDefault.
  useEffect(() => {
    if (!editing) return;
    const onDown = (e: PointerEvent) => {
      const el = inputRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      commitRef.current();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [editing]);

  // A cloud that disappears under an open editor (a re-cluster landing
  // mid-rename) needs no cleanup effect: the input unmounts with it, because
  // `isEditing` is only ever true for a cloud this render is drawing, and
  // `commit` clears the state and writes nothing on the next press.

  return (
    <>
      {layout.clouds.map((c) => {
        const isEditing = editing?.key === c.key;
        const isDropTarget = dropTargetKey === c.key;
        const dim = isDropTarget ? 1 : focusedCloudKey && c.key !== focusedCloudKey && !isEditing ? DIM : 1;
        const renameable = !!onRenameCloud && (canRenameCloud?.(c) ?? false);
        return (
          <div
            key={`label-${c.key}`}
            // The rename opens from the SECOND press rather than from a
            // `dblclick`, for two reasons. `dblclick` fires only after both
            // pointerups, and each of those toggles cloud focus (ADR 0024) —
            // so every rename attempt used to dim the whole canvas and undim it
            // again before the editor appeared. And a `dblclick` handler on this
            // wrapper still fires for a double-click *inside* the input, where
            // it reset the draft to the cloud's old name and silently threw away
            // what had been typed. Taking over the press means neither can
            // happen: no drag is armed, no focus toggle, no dblclick handler.
            onPointerDown={
              isEditing
                ? // Still swallow presses on the wrapper's own padding while
                  // editing: the capture-phase listener above has already
                  // committed by the time this runs, but letting it through to
                  // onCanvasDown would also clear the selection.
                  (e) => e.stopPropagation()
                : (e) => {
                    const prev = lastPress.current;
                    const second =
                      renameable &&
                      e.button === 0 &&
                      prev?.key === c.key &&
                      e.timeStamp - prev.at < RENAME_DOUBLE_CLICK_MS &&
                      // Native double-click semantics: the two presses have to
                      // land in the same place. Without this, nudging a label
                      // and then clicking it opens the editor instead of
                      // focusing the cloud.
                      Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < RENAME_DOUBLE_CLICK_SLOP;
                    lastPress.current = { key: c.key, at: e.timeStamp, x: e.clientX, y: e.clientY };
                    if (second) {
                      e.preventDefault();
                      e.stopPropagation();
                      lastPress.current = null;
                      setEditing({ key: c.key });
                      setDraft(c.label);
                      return;
                    }
                    onCloudLabelDown(e, c.key);
                  }
            }
            style={{
              position: "absolute",
              left: c.labelX,
              top: c.labelY - 34,
              transform: `translateX(-50%)${isDropTarget ? " scale(1.05)" : ""}`,
              padding: "3px 8px",
              whiteSpace: "nowrap",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: c.color,
              textShadow: isEditing ? "none" : `0 0 12px ${hexA(c.color, 0.55)}, 0 1px 3px rgba(0,0,0,0.7)`,
              background: isDropTarget ? "rgba(8,8,8,.9)" : "transparent",
              border: isDropTarget ? `1px solid ${hexA(c.color, 0.72)}` : "1px solid transparent",
              // `dim` already exempts the cloud being edited: a rename opens on
              // the second press, after the first has focused some cloud, so
              // without the exemption the input could render at 22% opacity —
              // an all-but-invisible box still swallowing every keystroke.
              opacity: dim,
              transition: "opacity .2s ease",
              cursor: isEditing ? "text" : "grab",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              // Tiles carry z-index 2/12/30; an un-indexed label paints under
              // any tile that overlaps it, which would bury the input.
              zIndex: isEditing ? 31 : undefined,
            }}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  // Escape is handled on `window` with no is-typing guard, so
                  // without this it would also close the drawer / chat / trash.
                  e.stopPropagation();
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") setEditing(null);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  font: "inherit",
                  letterSpacing: "inherit",
                  color: "var(--t1)",
                  background: "var(--bg-el)",
                  border: `1px solid ${c.color}`,
                  borderRadius: 2,
                  padding: "0 4px",
                  width: Math.max(90, draft.length * 10),
                  outline: "none",
                  textTransform: "uppercase",
                  userSelect: "text",
                  WebkitUserSelect: "text",
                  touchAction: "auto",
                }}
              />
            ) : (
              isDropTarget
                ? `MOVE ${dropCount || 1} TO ${c.label.toUpperCase()}`
                : c.label.toUpperCase()
            )}
          </div>
        );
      })}
    </>
  );
}

export const CloudLabels = memo(CloudLabelsBase);
export default memo(CloudDecor);
