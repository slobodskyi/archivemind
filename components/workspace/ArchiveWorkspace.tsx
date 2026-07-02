"use client";

import type { Photo } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import NeuralView from "@/components/canvas/NeuralView";
import AppHeader from "@/components/header/AppHeader";
import LeftSidebar from "@/components/sidebar/LeftSidebar";
import BottomToolbar from "@/components/toolbar/BottomToolbar";
import PhotoDrawer from "@/components/drawer/PhotoDrawer";
import Toast from "@/components/modals/Toast";

interface ArchiveWorkspaceProps {
  initialPhotos: Photo[];
}

export default function ArchiveWorkspace({ initialPhotos }: ArchiveWorkspaceProps) {
  const ws = useWorkspace(initialPhotos);

  const showViewTabs = ws.projCurrent !== "all";
  const showCanvasTools = ws.view !== "map" && ws.view !== "timeline";
  const showAddToProject = ws.selectedIds.size > 0;

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
      <InfiniteGrid gridSize={ws.gridSize} gridPos={ws.gridPos} gridOpacity={ws.gridOpacity} />

      <PanZoomCanvas
        setCanvasRef={ws.setCanvasRef}
        onCanvasDown={ws.onCanvasDown}
        canvasCursor={ws.canvasCursor}
        canvasTransform={ws.canvasTransform}
        marquee={ws.marquee}
      >
        <NeuralView
          layout={ws.neuralLayout}
          photos={ws.photos}
          selectedIds={ws.selectedIds}
          hoveredId={ws.hoveredId}
          onNodeDown={ws.onNodeDown}
          onCardDown={ws.onCardDown}
          setHover={ws.setHover}
          openDrawer={ws.openDrawer}
          deletePhoto={ws.deletePhoto}
        />
      </PanZoomCanvas>

      <AppHeader zoomPct={ws.zoomPct} showViewTabs={showViewTabs} />

      <LeftSidebar expanded={ws.sidebarExpanded} onToggle={ws.toggleSidebar} />

      <BottomToolbar
        tool={ws.tool}
        showCanvasTools={showCanvasTools}
        showAddToProject={showAddToProject}
        selCount={ws.selectedIds.size}
        zoomPct={ws.zoomPct}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onFit={ws.onFit}
        onZoomReset={ws.onZoomReset}
      />

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
