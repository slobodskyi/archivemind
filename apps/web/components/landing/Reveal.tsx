"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./landing.module.css";

/** Reveal-on-enter, the way frame.io does it: nothing below the fold is visible
 *  until it scrolls into view, then it rises into place. One observer per node,
 *  disconnected on first entry — this is an entrance, not a toggle.
 *
 *  root is the viewport (null): the landing's scroll container is fixed and
 *  full-screen, so its children genuinely move through the viewport. */
export default function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** Stagger in ms — siblings should step by ~80–120ms, not more. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${styles.reveal}${shown ? ` ${styles.revealIn}` : ""}${className ? ` ${className}` : ""}`}
      style={{ ["--d" as string]: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
