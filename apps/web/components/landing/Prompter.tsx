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
    tag: "Ingest",
    title: "You upload. Nothing else happens.",
    body: "Files land in your own storage, deduplicated by checksum. EXIF and previews are extracted — HEIC and RAW included — and that is the whole of it. No model has seen your archive yet.",
  },
  {
    tag: "Analyze",
    title: "AI runs when you press the button.",
    body: "Not on upload, not on a schedule, not quietly in the background. When you ask for it, each photo gets tags, facts, and an embedding — and you can watch the queue drain in real time.",
  },
  {
    tag: "Cluster",
    title: "Your photos sort themselves out.",
    body: "Embeddings get clustered, so “yoga”, “stretching” and “йога” end up in one group instead of three. The clusters hold still between sessions and read the same in every project.",
  },
  {
    tag: "Caption",
    title: "Captions in your language, in your voice.",
    body: "Generate them per language and per style, edit any line by hand, and your edit is never silently overwritten — regeneration asks first.",
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
          <h2 className={`${styles.display} ${styles.h2}`}>Nothing happens to your archive until you say so.</h2>
          <p className={styles.lede}>
            Four jobs, in order, each one visible while it runs. The expensive ones only ever start on a click.
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
