import type { Metadata, Viewport } from "next";
import TopProgressBar from "@/components/nav/TopProgressBar";
import "@fontsource/space-mono/latin-400.css";
import "@fontsource/space-mono/latin-700.css";
import "@fontsource/jetbrains-mono/cyrillic-400.css";
import "@fontsource/jetbrains-mono/cyrillic-700.css";
import "@fontsource-variable/inter-tight/wght.css";
import "./globals.css";

// Space Mono ships no Cyrillic glyphs, so Ukrainian/Russian text fell through to
// the system monospace (oversized, off-brand). JetBrains Mono has full Cyrillic
// and a near-identical mono footprint; it's the per-glyph fallback after Space
// Mono, so Latin stays Space Mono and only Cyrillic uses it. Fontsource keeps
// both families inside the build instead of fetching Google assets at build
// time; Google can remove a versioned file and otherwise break every deploy.

export const metadata: Metadata = {
  title: "ArchiveMind",
  description: "AI-powered creator archive workspace",
};

// Next already emits `width=device-width, initial-scale=1` by default; this adds
// the two things a full-viewport canvas app needs on a tablet/phone.
// `interactiveWidget: "resizes-content"` makes the on-screen keyboard shrink the
// viewport instead of sliding the page up — without it the bottom action bars
// (which sit at `bottom: 20` of a 100dvh shell) end up under the keyboard.
// Deliberately NOT setting `userScalable: false`: page zoom stays available for
// accessibility, and the canvas keeps pinch for itself via `touch-action: none`.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
  themeColor: "#080808",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <TopProgressBar />
        {children}
      </body>
    </html>
  );
}
