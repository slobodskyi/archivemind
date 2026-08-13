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

const HEADLINE = ["Your", "archive", "is", "finally", "smart."];
const ACCENT_WORD = 4;

const FEATURES = [
  {
    title: "An infinite canvas, not a folder tree",
    body: "Pan, zoom, drag. Curate focused workspaces from a large archive, then export the selected files as a PDF, captions CSV or ZIP.",
  },
  {
    title: "Search the way you'd describe it",
    body: "Ask for a place, a camera, a season. Image embeddings, full-text search and EXIF filters run as one query, strongest matches first.",
  },
  {
    title: "A workspace, and three ways to sort it",
    body: "Canvas is where you work. Timeline, Map and Topic are sorting views — by day, by where you were standing, by what a file is about — for selecting and dividing your files.",
  },
  {
    title: "Bring your files from anywhere",
    body: "Drag a folder in, or import straight from Google Drive and Dropbox. Duplicates collapse by checksum before they cost you storage.",
  },
];

const FACTS = [
  { n: "1", l: "search box for a place, a camera, a subject" },
  { n: "∞", l: "projects and new files from one archive" },
  { n: "4", l: "views — one to work in, three to sort by" },
  { n: "3", l: "import routes — drag & drop, Drive, Dropbox" },
];

/** Plans. The feature lines are all shipped behaviour; the prices and the
 *  storage/analysis ceilings are placeholders until billing is decided — there
 *  is no checkout behind these buttons yet, every CTA lands on /signup. */
const PLANS = [
  {
    name: "Free",
    price: "$0",
    per: "forever",
    note: "Enough to see whether it thinks the way you do.",
    cta: "Start free",
    featured: false,
    items: [
      "1 workspace, unlimited projects",
      "10 GB of originals",
      "500 files analyzed per month",
      "Drag & drop, Google Drive, Dropbox",
      "All four views + hybrid search",
    ],
  },
  {
    name: "Creator",
    price: "$18",
    per: "per month",
    note: "For the archive you actually work with.",
    cta: "Start free trial",
    featured: true,
    items: [
      "Everything in Free",
      "1 TB of originals",
      "25,000 files analyzed per month",
      "Multilingual styled captions",
      "Export to PDF, originals or ZIP",
      "Semantic clustering across the workspace",
    ],
  },
  {
    name: "Team",
    price: "$49",
    per: "per month",
    note: "One archive, your whole crew in it.",
    cta: "Start free trial",
    featured: false,
    items: [
      "Everything in Creator",
      "Up to 5 members",
      "Shared workspaces & projects",
      "Roles & permissions",
      "Collaborate on the same canvas",
    ],
  },
  {
    name: "Studio",
    price: "Let’s talk",
    per: "annual",
    note: "Bigger teams, longer retention, priority help.",
    cta: "Contact us",
    featured: false,
    items: [
      "Everything in Team",
      "Unlimited members",
      "Storage priced to your volume",
      "Unlimited analysis",
      "Custom retention windows",
      "Priority support",
    ],
  },
];

const MARQUEE = [
  "HEIC & RAW",
  "EXIF GPS on a real map",
  "Multilingual captions",
  "Semantic clusters",
  "Workspace exports",
  "Checksum dedupe",
  "Realtime job progress",
  "Google Drive import",
  "Dropbox import",
  "Hybrid search",
];

export default function LandingShell({ year }: { year: number }) {
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
    <div ref={scrollRef} className={styles.root}>
      <header className={`${styles.nav}${stuck ? ` ${styles.navStuck}` : ""}`}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true" />
          ArchiveMind
        </Link>

        {/* Nav order tracks the order the sections actually appear in below —
            Features sits before Pipeline on the page, so it does here too. */}
        <nav className={styles.navLinks} aria-label="Sections">
          <a className={styles.navLink} href="#how">
            How it works
          </a>
          <a className={styles.navLink} href="#features">
            Features
          </a>
          <a className={styles.navLink} href="#pipeline">
            Pipeline
          </a>
          <a className={styles.navLink} href="#pricing">
            Pricing
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
              <span className={styles.eyebrow}>Archive workspace for visual creators</span>

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
                ArchiveMind organizes, analyzes and understands every file you have — then lets you build
                projects, create new files from your originals, and work through it all together with your team.
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
                A different approach to keeping creative work organized.
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

        {/* -------------------------------------------------------- pricing */}
        <section className={styles.section} id="pricing">
          <Reveal>
            <div className={styles.sectionHead}>
              <span className={styles.eyebrow}>Pricing</span>
              <h2 className={`${styles.display} ${styles.h2}`}>
                Pay for the archive you keep, not the seats you don&rsquo;t fill.
              </h2>
              <p className={styles.lede}>
                Every plan gets every view, every import route and the whole search stack. What changes is how much
                you can store and how much of it you analyze.
              </p>
            </div>
          </Reveal>

          <div className={styles.planTable}>
            {PLANS.map((p, i) => (
              <Reveal
                key={p.name}
                delay={i * 90}
                className={`${styles.plan}${p.featured ? ` ${styles.planFeatured}` : ""}`}
              >
                {p.featured ? <span className={styles.planFlag}>Most popular</span> : null}
                <span className={styles.planName}>{p.name}</span>
                <span className={styles.planPriceRow}>
                  <span className={`${styles.display} ${styles.planPrice}`}>{p.price}</span>
                  <span className={styles.planPer}>{p.per}</span>
                </span>
                <p className={styles.planNote}>{p.note}</p>

                <ul className={styles.planList}>
                  {p.items.map((it) => (
                    <li key={it} className={styles.planItem}>
                      {it}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/signup"
                  className={`${styles.btn} ${styles.planCta}${p.featured ? "" : ` ${styles.btnGhost}`}`}
                >
                  {p.cta}
                </Link>
              </Reveal>
            ))}
          </div>

          <p className={styles.planFoot}>
            Prices in USD. Your originals stay yours — cancel and you can export or download everything.
          </p>
        </section>

        {/* --------------------------------------------------------- closer */}
        <section className={styles.closer}>
          <div className={styles.closerGlow} aria-hidden="true" />
          <Reveal className={styles.closerInner}>
            <span className={styles.eyebrow}>Start today</span>
            <h2 className={`${styles.display} ${styles.closerTitle}`}>
              You do the creative work.
              <br />
              We&rsquo;ll manage the archive.
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
          <a className={styles.footerLink} href="#pricing">
            Pricing
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
