import type { Metadata } from "next";
import "./public-share.css";

export const metadata: Metadata = {
  title: { absolute: "Shared publication · ArchiveMind" },
  description: "A private publication preview shared with ArchiveMind.",
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

export default function PublicShareLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
