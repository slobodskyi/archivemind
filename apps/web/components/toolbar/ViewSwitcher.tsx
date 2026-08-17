import { memo } from "react";
import type { ViewMode } from "@/types";
import {
  ViewCanvasIcon,
  ViewTimelineIcon,
  ViewMapIcon,
  ViewSenseIcon,
} from "@/components/icons/icons";

interface ViewSwitcherProps {
  show: boolean;
  view: ViewMode;
  onSelect: (v: ViewMode) => void;
}

/** Canvas first — it is the grid you work in; the rest re-sort the same tiles. */
const VIEWS: { key: ViewMode; label: string; Icon: typeof ViewCanvasIcon; title: string }[] = [
  { key: "neural", label: "CANVAS", Icon: ViewCanvasIcon, title: "Canvas — the file grid" },
  { key: "timeline", label: "TIMELINE", Icon: ViewTimelineIcon, title: "Organize by capture date" },
  { key: "sense", label: "TOPIC", Icon: ViewSenseIcon, title: "Organize by what the AI sees" },
  // The geographic map goes last — it is the one view that is not a tile surface.
  { key: "map", label: "MAP", Icon: ViewMapIcon, title: "Organize by place" },
];

/** The bottom segmented control, replacing the header view tabs + the separate
 *  `WorkspaceToggle` that used to hold CANVAS apart from them. The split was the
 *  problem it solved: Canvas sat in the breadcrumb as a filled button while its
 *  three peers sat centred in the header as flat tabs, so the one control that
 *  answers "how are these tiles arranged right now" was two controls in two
 *  places. Four peers in one strip, at the bottom where the other canvas
 *  controls live, states the question once.
 *
 *  Bottom-centred at 20px in a 42px-tall strip, which is why `SortingActionBar`
 *  sits at 72 — the two stack, and the sorting bar has to clear this one. Their
 *  padding (3), gap (3), radius (3) and button height (34) are deliberately
 *  identical: they are one control surface in two rows, and any change here has
 *  to move both. */
function ViewSwitcher({ show, view, onSelect }: ViewSwitcherProps) {
  if (!show) return null;

  return (
    <div
      // Below 760px it spans the width and wraps instead of centring on an
      // overflowing row; below 640px the labels go and the icons carry it.
      className="am-viewswitcher"
      style={{
        position: "absolute",
        left: "50%",
        bottom: 20,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 3,
        padding: 3,
        background: "rgba(20,20,20,.92)",
        border: "1px solid var(--bd)",
        borderRadius: 3,
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,.45)",
        zIndex: 35,
      }}
    >
      {VIEWS.map(({ key, label, Icon, title }) => {
        const active = view === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            // `am-tb` is the app-wide touch-size rule (44px on a coarse
            // pointer). This control was the one piece of bottom chrome
            // without it: 28px tall next to 44px action buttons, which read as
            // two different sizes of the same thing and was under the target
            // size the rest of the app already commits to.
            className="am-tb"
            title={title}
            // The label is hidden on a phone, so the accessible name cannot
            // come from it.
            aria-label={label}
            aria-pressed={active}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              // 34px is the icon-button size the left toolbar and both action
              // bars already use, and this control was the last holdout at 28.
              // #213 fixed exactly that mismatch for touch (28 next to 44) and
              // left desktop alone; the same two-sizes-of-one-thing problem was
              // still visible here, one strip below the sorting bar.
              height: 34,
              padding: "0 12px",
              border: 0,
              borderRadius: 2,
              fontSize: 10.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              fontFamily: "inherit",
              cursor: "pointer",
              background: active ? "var(--bg-el)" : "transparent",
              // Inactive segments use --t2b (4.72:1); --t3 (2.96:1) fails WCAG.
              color: active ? "var(--t1)" : "var(--t2b)",
            }}
          >
            {/* 14, not the bars' 16: these segments carry a text label, so the
                glyph is a locator rather than the whole control. The `pointer:
                coarse` rule in globals.css still lifts it to 16, where the
                label is hidden. */}
            <Icon width={14} height={14} />
            <span className="am-viewswitcher-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default memo(ViewSwitcher);
