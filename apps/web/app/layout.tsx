import type { Metadata } from "next";
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
