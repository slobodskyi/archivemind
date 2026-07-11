"use client";

import { useEffect, useRef, useState } from "react";

/** rAF-smoothed display value for a 0..1 progress target. Eases toward the
 *  target, trickles slightly ahead while the target stalls (capped at 98.5%),
 *  never moves backward mid-run, and wraps up quickly once the target hits 1.
 *  Deterministic — no Math.random in this codebase (see ARCHITECTURE.md).
 *
 *  A target that drops by more than 0.5 is a new run (upload → done → new
 *  upload) and hard-resets the display. */
export function useSmoothProgress(target: number, active: boolean): number {
  const [display, setDisplay] = useState(0);
  const raw = useRef(0);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (!active) {
      raw.current = 0;
      const raf = requestAnimationFrame(() => setDisplay(0));
      return () => cancelAnimationFrame(raf);
    }
    let raf = 0;
    const tick = () => {
      const t = targetRef.current;
      let v = raw.current;
      if (t + 0.5 < v) {
        v = t; // new run started while the hook stayed active
      } else if (t >= 1) {
        v += (1 - v) * 0.25;
        if (1 - v < 0.001) v = 1;
      } else if (v < t) {
        v += (t - v) * 0.12;
      } else {
        const cap = Math.min(t + 0.05, 0.985);
        if (v < cap) v += (cap - v) * 0.004;
      }
      raw.current = v;
      // Quantize to 0.1% so a re-render only happens when the change is visible.
      setDisplay((prev) => (v === 1 || Math.abs(v - prev) >= 0.001 ? v : prev));
      if (v < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return display;
}
