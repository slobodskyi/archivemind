"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/** Thin route-transition bar. Every page here is a dynamic, cookie-scoped
 *  route, and most navigation is programmatic (`router.push`) — Next renders
 *  no pending UI for that, so a click on a slow connection looks dead.
 *  Call `navProgressStart()` right before any push/Link navigation; the bar
 *  trickles toward ~90% and completes when the pathname actually changes.
 *
 *  Deterministic on purpose — no `Math.random` in this codebase (see
 *  ARCHITECTURE.md); the trickle is a fixed asymptotic curve. */

let notifyStart: (() => void) | null = null;

/** Kick the top progress bar (no-op on the server / before mount). */
export function navProgressStart(): void {
  notifyStart?.();
}

/** If the pathname never changes (failed or same-route push), finish quietly. */
const STALL_TIMEOUT_MS = 8000;
const FADE_MS = 240;

export default function TopProgressBar() {
  const pathname = usePathname();
  const bar = useRef<HTMLDivElement | null>(null);
  const active = useRef(false);
  const width = useRef(0);
  const raf = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    const clearTimers = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };

    const tick = () => {
      // Asymptotic trickle: fast at first, slows as it approaches 90%.
      width.current += (90 - width.current) * 0.018;
      if (bar.current) bar.current.style.width = `${width.current}%`;
      if (active.current) raf.current = requestAnimationFrame(tick);
    };

    const finish = () => {
      if (!active.current) return;
      active.current = false;
      cancelAnimationFrame(raf.current);
      clearTimers();
      const node = bar.current;
      if (!node) return;
      node.style.width = "100%";
      timers.current.push(
        setTimeout(() => {
          node.style.opacity = "0";
        }, 60),
        setTimeout(() => {
          node.style.transition = "none";
          node.style.width = "0%";
          // Restore the transition a frame later so the reset jump is invisible.
          requestAnimationFrame(() => {
            node.style.transition = `opacity ${FADE_MS}ms ease`;
          });
        }, 60 + FADE_MS),
      );
    };

    const start = () => {
      clearTimers();
      cancelAnimationFrame(raf.current);
      const node = bar.current;
      if (node) {
        node.style.transition = `opacity ${FADE_MS}ms ease`;
        node.style.opacity = "1";
        if (!active.current) {
          width.current = 6;
          node.style.width = "6%";
        }
      }
      active.current = true;
      raf.current = requestAnimationFrame(tick);
      timers.current.push(setTimeout(finish, STALL_TIMEOUT_MS));
    };

    notifyStart = start;
    finishRef.current = finish;
    return () => {
      notifyStart = null;
      finishRef.current = () => {};
      active.current = false;
      cancelAnimationFrame(raf.current);
      clearTimers();
    };
  }, []);

  // Navigation landed: the pathname under the app router changed.
  useEffect(() => {
    finishRef.current();
  }, [pathname]);

  return (
    <div
      aria-hidden
      style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, zIndex: 130, pointerEvents: "none" }}
    >
      <div
        ref={bar}
        style={{
          height: "100%",
          width: "0%",
          background: "var(--ac)",
          boxShadow: "0 0 8px rgba(57,255,106,.5)",
          opacity: 1,
        }}
      />
    </div>
  );
}
