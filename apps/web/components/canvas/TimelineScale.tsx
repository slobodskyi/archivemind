import { memo } from "react";
import { timelineTierFits, type CloudLayout, type TimeSpan } from "@/lib/layout";

/** The Timeline's own chrome: the date axis, and the month/year ruler under it
 *  (ADR 0024 as amended). Everything here lives inside the canvas transform, so
 *  a plain `1px` line is `scale` px on screen and a 15px label is `15 * scale` —
 *  which is exactly how a zoomed-out timeline turned into an unreadable smear of
 *  dates on a line nobody could see. So every measurement below comes in one of
 *  two kinds and they are never mixed:
 *
 *  - **content px** — a span's x range, the width of a bracket: this is real
 *    geometry and must zoom with the tiles.
 *  - **screen px** — every thickness, gap, font and chip: divided by `scale` so
 *    it renders at a constant size at any zoom, the way a ruler behaves.
 *
 *  Which tier is legible then depends only on how wide its span is on screen,
 *  so the day tier hands over to months and months to years as you zoom out —
 *  and a year, whose span is the whole of its months, is what always survives.
 *  Nothing here takes pointer events: the ruler is read, never grabbed, and the
 *  canvas underneath stays draggable through it. */
interface TimelineScaleProps {
  layout: CloudLayout;
  /** Live canvas zoom — the divisor that keeps this layer a constant size. */
  scale: number;
  /** A focused day (ADR 0024) fades every other day's tick, like its cloud. */
  focusedCloudKey: string | null;
}

/** Vertical margin the year stripes/separators extend past the content, so they
 *  read as columns the whole timeline stands in rather than as boxes around it. */
const BAND_PAD = 160;
/** Screen px below the axis line for each ruler row's centre line. Year first:
 *  it is the tier that never disappears, so nothing moves under the reader when
 *  the month row drops out. */
const YEAR_ROW_Y = 16;
const MONTH_ROW_Y = 36;
/** Screen-px gap between a bracket's ends and its span's borders. */
const BRACKET_GUTTER = 9;
const BRACKET_CAP = 7;

const YEAR_LINE = "rgba(255,255,255,.22)";
const MONTH_LINE = "rgba(255,255,255,.12)";

/** Behind the tiles: the year stripes and boundaries, the shade the ruler sits
 *  on, the axis line itself and one tick per day column. */
function TimelineScale({ layout, scale, focusedCloudKey }: TimelineScaleProps) {
  const axis = layout.axis;
  if (!axis) return null;
  const px = (n: number) => n / scale; // screen px → content px at this zoom
  const top = layout.bounds.yt - BAND_PAD;
  const height = layout.bounds.yb + BAND_PAD - top;
  // Once the day columns are too narrow to label, the months become the finest
  // readable tier and earn their own full-height boundaries. While days ARE
  // readable those lines would only add noise to an already busy canvas.
  const dayTier = timelineTierFits(axis.columnW, scale, "day");

  return (
    <>
      {/* Alternating year stripe. Faded at both ends so the band reads as a
          column of the canvas and not as a rectangle drawn around the tiles. */}
      {axis.years.map((y, i) =>
        i % 2 === 1 ? (
          <div
            key={`yr-band-${y.key}`}
            style={{
              position: "absolute",
              left: y.x1,
              top,
              width: y.x2 - y.x1,
              height,
              background:
                "linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,.026) 14%, rgba(255,255,255,.026) 86%, rgba(255,255,255,0) 100%)",
              pointerEvents: "none",
            }}
          />
        ) : null,
      )}

      {/* Month boundaries, and after them the year boundaries — drawn second so
          the stronger line wins on the January border, where the two coincide. */}
      {!dayTier &&
        axis.months.slice(1).map((m) => (
          <div
            key={`mo-edge-${m.key}`}
            style={{
              position: "absolute",
              left: m.x1,
              top,
              width: 0,
              height,
              borderLeft: `${px(1)}px solid ${MONTH_LINE}`,
              pointerEvents: "none",
            }}
          />
        ))}
      {axis.years.slice(1).map((y) => (
        <div
          key={`yr-edge-${y.key}`}
          style={{
            position: "absolute",
            left: y.x1,
            top,
            width: 0,
            height,
            borderLeft: `${px(1)}px solid ${YEAR_LINE}`,
            pointerEvents: "none",
          }}
        />
      ))}

      {/* The shade the ruler rows sit on. At any zoom past ~1:1 it falls inside
          the clear band the layout keeps around the axis; zoomed out it dims the
          top row of that day's files instead, which is the trade that keeps the
          dates readable when the files are 6px tall. */}
      <div
        style={{
          position: "absolute",
          left: axis.x1,
          top: axis.y,
          width: axis.x2 - axis.x1,
          height: px(MONTH_ROW_Y + 14),
          background: "linear-gradient(to bottom, rgba(8,8,8,.82), rgba(8,8,8,0))",
          pointerEvents: "none",
        }}
      />

      {/* The axis line and a tick per day. Both counter-scaled: a hairline that
          thins with the zoom is gone exactly when the view needs a spine. */}
      <div
        style={{
          position: "absolute",
          left: axis.x1,
          top: axis.y,
          width: axis.x2 - axis.x1,
          height: 0,
          borderTop: `${px(1)}px solid var(--bdh)`,
          pointerEvents: "none",
        }}
      />
      {layout.clouds.map((c) => (
        <div
          key={`tick-${c.key}`}
          style={{
            position: "absolute",
            left: c.labelX,
            top: axis.y - px(4),
            width: 0,
            height: px(9),
            borderLeft: `${px(2)}px solid ${c.color}`,
            opacity: focusedCloudKey && c.key !== focusedCloudKey ? 0.22 : 1,
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

interface TimelineScaleLabelsProps {
  layout: CloudLayout;
  scale: number;
}

/** One tier's bracket — the span's real extent, drawn at a constant thickness —
 *  with its label centred on it. The chip is opaque, so it reads as breaking the
 *  line rather than sitting on it. Its coordinates are relative to the wrapper
 *  below, which is anchored on the axis line: x is content, y is screen px down
 *  from the axis. */
function RulerSpan({
  span,
  scale,
  rowY,
  fontSize,
  color,
  line,
  text,
}: {
  span: TimeSpan;
  scale: number;
  rowY: number;
  fontSize: number;
  color: string;
  line: string;
  text: string;
}) {
  const px = (n: number) => n / scale;
  const y = px(rowY);
  const width = Math.max(0, span.x2 - span.x1 - px(BRACKET_GUTTER) * 2);
  const cap = {
    position: "absolute" as const,
    top: y - px(BRACKET_CAP / 2),
    width: 0,
    height: px(BRACKET_CAP),
    borderLeft: `${px(1)}px solid ${line}`,
    pointerEvents: "none" as const,
  };
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: span.x1 + px(BRACKET_GUTTER),
          top: y,
          width,
          height: 0,
          borderTop: `${px(1)}px solid ${line}`,
          pointerEvents: "none",
        }}
      />
      {width > 0 && (
        <>
          <div style={{ ...cap, left: span.x1 + px(BRACKET_GUTTER) }} />
          <div style={{ ...cap, left: span.x2 - px(BRACKET_GUTTER) }} />
        </>
      )}
      <div
        style={{
          position: "absolute",
          left: span.cx,
          top: y,
          // transform-origin at the element's own layout point, so `scale()`
          // grows the chip about the anchor and the translate that centres it
          // is scaled with it — the chip lands centred on (cx, row) at every
          // zoom, at a constant size.
          transformOrigin: "0 0",
          transform: `scale(${1 / scale}) translate(-50%, -50%)`,
          padding: "2px 7px",
          whiteSpace: "nowrap",
          fontSize,
          // The two rows are 20 screen px apart and each chip is drawn at a
          // constant size, so the line box has to be one too — an inherited
          // line-height is what would let the year row grow into the month row.
          lineHeight: 1,
          fontWeight: 700,
          letterSpacing: "0.12em",
          color,
          background: "rgba(10,10,10,.92)",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {text}
      </div>
    </>
  );
}

/** On top of the tiles: the month and year rows. A span too narrow on screen to
 *  hold its own label drops out entirely, bracket included — the tier below it
 *  is still drawing the boundary, so nothing about the division is lost. The
 *  test is per span rather than per tier on purpose: a fortnight-long month
 *  beside a one-day month has genuinely different room. */
function TimelineScaleLabelsBase({ layout, scale }: TimelineScaleLabelsProps) {
  const axis = layout.axis;
  if (!axis) return null;
  const dayTier = timelineTierFits(axis.columnW, scale, "day");

  return (
    <div style={{ position: "absolute", left: 0, top: axis.y, width: 0, height: 0, pointerEvents: "none", zIndex: 34 }}>
      {axis.years.map((y) => {
        const w = y.x2 - y.x1;
        if (!timelineTierFits(w, scale, "year")) return null;
        // The count is what a year still has to say once the files under it are
        // too small to count by eye — so it appears exactly when the day tier
        // has dropped out and the year has the room for it.
        const withCount = !dayTier && timelineTierFits(w, scale, "yearCount");
        return (
          <RulerSpan
            key={`yr-${y.key}`}
            span={y}
            scale={scale}
            rowY={YEAR_ROW_Y}
            fontSize={12.5}
            color="var(--t1)"
            line={YEAR_LINE}
            text={withCount ? `${y.label} · ${y.count}` : y.label}
          />
        );
      })}
      {axis.months.map((m) =>
        !timelineTierFits(m.x2 - m.x1, scale, "month") ? null : (
          <RulerSpan
            key={`mo-${m.key}`}
            span={m}
            scale={scale}
            rowY={MONTH_ROW_Y}
            fontSize={10.5}
            color="var(--t2)"
            line={MONTH_LINE}
            text={m.label}
          />
        ),
      )}
    </div>
  );
}

export const TimelineScaleLabels = memo(TimelineScaleLabelsBase);
export default memo(TimelineScale);
