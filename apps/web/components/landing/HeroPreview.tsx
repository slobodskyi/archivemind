"use client";

import styles from "./landing.module.css";

/** The hero's right column: one photo, opened up. frame.io fills this slot with
 *  a 4K product video; we have no footage yet, so the claim in the headline —
 *  "knows what's in it" — is demonstrated instead of asserted, with the exact
 *  shape the drawer shows for a real analyzed asset: tags, a place, a caption
 *  line, EXIF.
 *
 *  Pure CSS animation, no runtime work: chips stagger in behind a scan pass
 *  that runs once. Everything stops flat under prefers-reduced-motion. */

const TAGS = ["yoga", "rooftop", "golden hour", "portrait", "summer"];

export default function HeroPreview() {
  return (
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewBar}>
        <span className={styles.stageDot} />
        <span className={styles.previewBarLabel}>IMG_4417.HEIC</span>
        <span className={styles.previewBarRight}>analyzed</span>
      </div>

      <div className={styles.previewShot}>
        <span className={styles.previewScan} />
        <div className={styles.previewChips}>
          {TAGS.map((t, i) => (
            <span key={t} className={styles.chip} style={{ ["--i" as string]: i }}>
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className={styles.previewMeta}>
        <p className={styles.previewCaption}>
          Rooftop stretch session as the sun drops behind the Dnipro — warm side light, hand-held.
        </p>
        <div className={styles.previewExif}>
          <span>Kyiv, UA</span>
          <span>35mm</span>
          <span>ƒ/1.8</span>
          <span>ISO 200</span>
        </div>
      </div>
    </div>
  );
}
