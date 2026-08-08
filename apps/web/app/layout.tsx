import type { Metadata, Viewport } from "next";
import { Space_Mono, JetBrains_Mono } from "next/font/google";
import TopProgressBar from "@/components/nav/TopProgressBar";
import "./globals.css";

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

// Space Mono ships no Cyrillic glyphs, so Ukrainian/Russian text fell through to
// the system monospace (oversized, off-brand). JetBrains Mono has full Cyrillic
// and a near-identical mono footprint; it's the per-glyph fallback after Space
// Mono, so Latin stays Space Mono and only Cyrillic uses it.
const monoCyrillic = JetBrains_Mono({
  variable: "--font-mono-cy",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "700"],
  display: "swap",
});

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
    <html lang="en" className={`${spaceMono.variable} ${monoCyrillic.variable}`}>
      <body>
        <TopProgressBar />
        {children}
      </body>
    </html>
  );
}
