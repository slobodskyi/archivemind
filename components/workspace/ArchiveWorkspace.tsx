"use client";

import { useState } from "react";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import AppHeader from "@/components/header/AppHeader";
import LeftSidebar from "@/components/sidebar/LeftSidebar";
import BottomToolbar from "@/components/toolbar/BottomToolbar";

export default function ArchiveWorkspace() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <InfiniteGrid />
      <AppHeader />
      <LeftSidebar expanded={sidebarExpanded} onToggle={() => setSidebarExpanded((v) => !v)} />
      <BottomToolbar />
    </div>
  );
}
