"use client";

import type { Photo } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import CanvasContent from "@/components/canvas/CanvasContent";
import AppHeader from "@/components/header/AppHeader";
import ViewTabs from "@/components/header/ViewTabs";
import IconRail from "@/components/rail/IconRail";
import UsagePill from "@/components/rail/UsagePill";
import BottomToolbar from "@/components/toolbar/BottomToolbar";
import BulkAiPanel from "@/components/bulk-ai/BulkAiPanel";
import PhotoDrawer from "@/components/drawer/PhotoDrawer";
import SearchModal from "@/components/modals/SearchModal";
import ImportDropdown from "@/components/modals/ImportDropdown";
import Toast from "@/components/modals/Toast";

interface ArchiveWorkspaceProps {
  initialPhotos: Photo[];
}

export default function ArchiveWorkspace({ initialPhotos }: ArchiveWorkspaceProps) {
  const ws = useWorkspace(initialPhotos);

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "var(--bg-canvas)",
      }}
    >
      <PanZoomCanvas
        setCanvasRef={ws.setCanvasRef}
        onCanvasDown={ws.onCanvasDown}
        canvasCursor={ws.canvasCursor}
        canvasTransform={ws.canvasTransform}
        marquee={ws.marquee}
      >
        <CanvasContent
          view={ws.view}
          layout={ws.layout}
          photos={ws.photos}
          selectedIds={ws.selectedIds}
          bookmarks={ws.bookmarks}
          hoveredId={ws.hoveredId}
          tileTransition={ws.tileTransition}
          onCardDown={ws.onCardDown}
          onHoverEnter={ws.setHover}
          onHoverLeave={() => ws.setHover(null)}
          onOpen={ws.openDrawer}
          onDelete={ws.deletePhoto}
          onBookmark={ws.toggleBookmark}
        />
      </PanZoomCanvas>

      <AppHeader
        zoomPct={ws.zoomPct}
        onZoomReset={ws.onZoomReset}
        onAnalyze={ws.runAINav}
        viewTabs={<ViewTabs view={ws.view} onSelect={ws.setView} />}
      />

      <IconRail tool={ws.tool} onToolSelect={ws.toolSelect} onOpenSearch={ws.openSearch} onRailAdd={ws.railAdd} />
      <UsagePill />

      <BottomToolbar
        tool={ws.tool}
        zoomPct={ws.zoomPct}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onAdd={ws.addToolbar}
        onFit={ws.onFit}
        onZoomReset={ws.onZoomReset}
      />

      <BulkAiPanel
        show={ws.bulkShow}
        idle={ws.bulkIdle}
        count={ws.bulkCount}
        thumbs={ws.bulkThumbs}
        bulkOps={ws.bulkOps}
        bulkLangs={ws.bulkLangs}
        bulkStyle={ws.bulkStyle}
        proc={ws.proc}
        onClear={ws.clearSelection}
        onToggleOp={ws.toggleOp}
        onToggleLang={ws.toggleBulkLang}
        onSetStyle={ws.setBulkStyle}
        onRun={ws.runBulk}
      />

      <ImportDropdown open={ws.impOpen} at={ws.impAt} onUpload={ws.doUpload} />

      <SearchModal open={ws.search} onClose={ws.closeSearch} />

      <PhotoDrawer
        photo={ws.drawerPhoto}
        lang={ws.drawerLang}
        style={ws.drawerStyle}
        copyLabel={ws.copyLabel}
        onPrev={() => ws.navDrawer(-1)}
        onNext={() => ws.navDrawer(1)}
        onClose={ws.closeDrawer}
        onSetLang={ws.setLang}
        onSetStyle={ws.setStyle}
        onRegen={ws.regen}
        onCopy={ws.copyCap}
        onGenSingle={() => ws.drawerPhoto && ws.genSingle(ws.drawerPhoto.id)}
      />

      <Toast show={ws.toast.show} text={ws.toast.text} />
    </div>
  );
}
