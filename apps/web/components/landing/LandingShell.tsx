"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import HeroGradient from "./HeroGradient";
import HeroPreview from "./HeroPreview";
import Prompter from "./Prompter";
import Reveal from "./Reveal";
import ScrubDemo from "./ScrubDemo";
import styles from "./landing.module.css";

/** The marketing landing (ADR 0036). Motion vocabulary borrowed from frame.io —
 *  sticky scroll storytelling, reveal-on-enter, a procedural hero gradient —
 *  rendered in ArchiveMind's own near-black/neon-green palette and mono voice.
 *
 *  Everything on this page is a claim we can back with shipped behaviour; there
 *  are no borrowed assets, no invented benchmarks and no third-party logos. */

const HEADLINE = ["Your", "archive", "finally", "knows", "what’s", "in", "it."];
const ACCENT_WORD = 3;

const FEATURES = [
  {
    title: "An infinite canvas, not a folder tree",
    body: "Pan, zoom, drag. Folders and artboards live on the canvas itself, and any artboard exports straight to a PDF.",
  },
  {
    title: "Search the way you'd describe it",
    body: "Ask for a place, a camera, a season. Image embeddings, full-text search and EXIF filters run as one query, strongest matches first.",
  },
  {
    title: "Four ways to look at the same archive",
    body: "A canvas, a timeline laid out day by day, a real map of where you were standing, and clouds of what the photos are about.",
  },
  {
    title: "Bring your files from anywhere",
    body: "Drag a folder in, or import straight from Google Drive and Dropbox. Duplicates collapse by checksum before they cost you storage.",
  },
];

const FACTS = [
  { n: "768", l: "dimensions in every image embedding" },
  { n: "3", l: "import routes — drag & drop, Drive, Dropbox" },
  { n: "30 days", l: "in trash before anything is erased for good" },
  { n: "0", l: "AI calls you didn’t ask for" },
];

const MARQUEE = [
  "HEIC & RAW",
  "EXIF GPS on a real map",
  "Multilingual captions",
  "Semantic clusters",
  "Artboard → PDF",
  "Checksum dedupe",
  "Realtime job progress",
  "Google Drive import",
  "Dropbox import",
  "Hybrid search",
];

export default function LandingShell({ fontClass, year }: { fontClass: string; year: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setStuck(el.scrollTop > 12);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={scrollRef} className={`${styles.root} ${fontClass}`}>
      <header className={`${styles.nav}${stuck ? ` ${styles.navStuck}` : ""}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          ArchiveMind
        </Link>

        <nav className={styles.navLinks} aria-label="Sections">
          <a className={styles.navLink} href="#how">
            How it works
          </a>
          <a className={styles.navLink} href="#pipeline">
            Pipeline
          </a>
          <a className={styles.navLink} href="#features">
            Features
          </a>
        </nav>

        <Link href="/login" className={`${styles.navLink} ${styles.navSignIn}`}>
          Sign in
        </Link>
        <Link href="/signup" className={`${styles.btn} ${styles.navCta}`}>
          Start free
        </Link>
      </header>

      <main>
        {/* ---------------------------------------------------------- hero */}
        <section className={styles.hero}>
          <HeroGradient />
          <div className={styles.heroGrid} aria-hidden="true" />

          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow}>AI-powered creator archive</span>

              <h1 className={`${styles.display} ${styles.h1}`}>
                {HEADLINE.map((w, i) => (
                  <span
                    key={w}
                    className={`${styles.word}${i === ACCENT_WORD ? ` ${styles.wordAccent}` : ""}`}
                    style={{ ["--i" as string]: i }}
                  >
                    {w}
                    {i < HEADLINE.length - 1 ? " " : ""}
                  </span>
                ))}
              </h1>

              <p className={styles.lede}>
                Drop in a decade of shoots. ArchiveMind reads every frame — what&rsquo;s in it, where it was
                taken, what it&rsquo;s about — and hands the whole archive back to you as one canvas and one
                search box.
              </p>

              <div className={styles.heroActions}>
                <Link href="/signup" className={styles.btn}>
                  Start free
                  <span className={styles.btnArrow} aria-hidden="true">
                    →
                  </span>
                </Link>
                <a href="#how" className={`${styles.btn} ${styles.btnGhost}`}>
                  See how it works
                </a>
              </div>

              <div className={styles.heroMeta}>
                <span>No credit card</span>
                <span>Originals stay yours</span>
                <span>Import from Drive &amp; Dropbox</span>
              </div>
            </div>

            <HeroPreview />
          </div>

          <div className={styles.scrollHint} aria-hidden="true">
            <span className={styles.scrollHintRail} />
            Scroll
          </div>
        </section>

        {/* ------------------------------------------------------- marquee */}
        <div className={styles.marquee} aria-hidden="true">
          <div className={styles.marqueeTrack}>
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={`${m}-${i}`} className={styles.marqueeItem}>
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* ---------------------------------------------------- scrub demo */}
        <ScrubDemo />

        {/* ------------------------------------------------------ features */}
        <section className={styles.section} id="features">
          <Reveal>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>What you get</span>
              <h2 className={`${styles.display} ${styles.h2}`}>
                Built for the archive you already have, not the one you wish you&rsquo;d labelled.
              </h2>
            </div>
          </Reveal>

          <div className={styles.tileTable}>
            {/* The Reveal element IS the grid cell — wrapping one would make the
                wrapper the grid item and leave the cell unstretched. */}
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 90} className={styles.featureCell}>
                <span className={styles.featureIndex}>0{i + 1}</span>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureBody}>{f.body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ prompter */}
        <Prompter />

        {/* --------------------------------------------------------- facts */}
        <div className={styles.factRow}>
          {FACTS.map((f, i) => (
            <Reveal key={f.l} delay={i * 80} className={styles.fact}>
              <span className={`${styles.display} ${styles.factNum}`}>{f.n}</span>
              <span className={styles.factLabel}>{f.l}</span>
            </Reveal>
          ))}
        </div>

        {/* --------------------------------------------------------- closer */}
        <section className={styles.closer}>
          <div className={styles.closerGlow} aria-hidden="true" />
          <Reveal className={styles.closerInner}>
            <span className={styles.eyebrow}>Start today</span>
            <h2 className={`${styles.display} ${styles.closerTitle}`}>
              Bring the archive.
              <br />
              We&rsquo;ll do the remembering.
            </h2>
            <Link href="/signup" className={styles.btn}>
              Create your archive
              <span className={styles.btnArrow} aria-hidden="true">
                →
              </span>
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>© {year} ArchiveMind</span>
        <div className={styles.footerLinks}>
          <a className={styles.footerLink} href="#how">
            How it works
          </a>
          <a className={styles.footerLink} href="#features">
            Features
          </a>
          <Link className={styles.footerLink} href="/login">
            Sign in
          </Link>
          <Link className={styles.footerLink} href="/signup">
            Create account
          </Link>
        </div>
      </footer>
    </div>
  );
}
