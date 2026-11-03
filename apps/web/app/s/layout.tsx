import type { Metadata } from "next";
import "../p/public-share.css";

/** Project share links (ADR 0051) — the same private, unindexed shell as a
 *  publication (ADR 0046): a capability URL must not leak through a Referer,
 *  a search index or an archive. */
export const metadata: Metadata = {
  title: { absolute: "Shared project · ArchiveMind" },
  description: "Files shared with you through ArchiveMind.",
  referrer: "no-referrer",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
    noimageindex: true,
    nosnippet: true,
    googleBot: {
      index: false,
      follow: false,
      noarchive: true,
      noimageindex: true,
      nosnippet: true,
    },
  },
};

export default function ProjectShareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
