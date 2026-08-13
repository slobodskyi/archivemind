"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./landing.module.css";

/** Sticky headline, moving story — frame.io's "Prompter" module. The left
 *  column pins while the right column's steps scroll past it, and whichever
 *  step is crossing the middle of the viewport lights up.
 *
 *  A centre band (rootMargin -45%/-45%) does the picking: exactly one step can
 *  occupy it, so there's no scroll-position arithmetic and no jitter at the
 *  boundaries. */

const STEPS = [
  {
    tag: "Add",
    title: "Add your files.",
    body: "Connect a cloud source — Google Drive or Dropbox — or drag them straight in from your computer. Duplicates collapse by checksum before they cost you storage.",
  },
  {
    tag: "Analyze",
    title: "Analyze all your content with AI.",
    body: "When you ask for it, the AI system reads every file — tags, facts, captions and embeddings — and you watch the queue drain in real time. Never automatic, never in the background.",
  },
  {
    tag: "Sort",
    title: "Sort and select everything you need.",
    body: "Re-sort the same files by day, by where you were standing, or by what they’re about — then pick out exactly the ones the job calls for.",
  },
  {
    tag: "Compile",
    title: "Compile a project, create new materials.",
    body: "Build a focused workspace from your selection, then turn those source files into a reusable draft for the job at hand.",
  },
  {
    tag: "Export",
    title: "Export your project in any format.",
    body: "Send it out as a PDF, as the original files, or bundled in a ZIP — whatever the next step needs.",
  },
];

export default function Prompter() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const i = stepRefs.current.indexOf(e.target as HTMLDivElement);
          if (i >= 0) setActive(i);
        }
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const el of stepRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className={styles.prompter} id="pipeline" aria-label="How the AI pipeline works">
      <div className={styles.prompterInner}>
        <div className={styles.prompterSticky}>
          <span className={styles.eyebrow}>The pipeline</span>
          <h2 className={`${styles.display} ${styles.h2}`}>From the files you add to the project you export.</h2>
          <p className={styles.lede}>
            Five steps, in order — add, analyze, sort, compile, export. The AI only ever runs when you ask it to,
            and every step is visible while it works.
          </p>
        </div>

        <div className={styles.prompterSteps}>
          {STEPS.map((s, i) => (
            <div
              key={s.tag}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              className={`${styles.prompterStep}${i === active ? ` ${styles.prompterStepOn}` : ""}`}
            >
              <h3 className={styles.prompterStepTitle}>{s.title}</h3>
              <p className={styles.prompterStepBody}>{s.body}</p>
              <span className={styles.prompterTag}>
                0{i + 1} · {s.tag}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
