"use client";

import type { Photo } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import NeuralView from "@/components/canvas/NeuralView";
import TimelineView from "@/components/canvas/TimelineView";
import TimelineHeader from "@/components/canvas/TimelineHeader";
import SenseView from "@/components/canvas/SenseView";
import MapView from "@/components/map/MapView";
import AppHeader from "@/components/header/AppHeader";
import ViewTabs from "@/components/header/ViewTabs";
import ProjectDropdown from "@/components/header/ProjectDropdown";
import AccountDropdown from "@/components/header/AccountDropdown";
import LeftSidebar from "@/components/sidebar/LeftSidebar";
import ChatPanel from "@/components/chat/ChatPanel";
import BottomToolbar from "@/components/toolbar/BottomToolbar";
import AddToProjectPopover from "@/components/toolbar/AddToProjectPopover";
import BulkAiPanel from "@/components/bulk-ai/BulkAiPanel";
import PhotoDrawer from "@/components/drawer/PhotoDrawer";
import SearchModal from "@/components/modals/SearchModal";
import HelpModal from "@/components/modals/HelpModal";
import ImportDropdown from "@/components/modals/ImportDropdown";
import Toast from "@/components/modals/Toast";

interface ArchiveWorkspaceProps {
  initialPhotos: Photo[];
}

export default function ArchiveWorkspace({ initialPhotos }: ArchiveWorkspaceProps) {
  const ws = useWorkspace(initialPhotos);

  const showCanvasTools = ws.view !== "map" && ws.view !== "timeline";
  const sidebarW = ws.sidebarExpanded ? 220 : 52;
  const contentLeft = sidebarW + (ws.chatOpen ? 320 : 0);

  const sendHelpTicket = () => {
    ws.closeHelp();
    ws.flashToast("Support ticket sent — we'll be in touch within 24h");
  };

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
        {ws.isNeural && (
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
        )}
        {ws.isTimelineView && (
          <TimelineView
            layout={ws.timelineLayout}
            photos={ws.projectPhotos}
            selectedIds={ws.selectedIds}
            onTlDown={ws.onTlDown}
          />
        )}
        {ws.isSenseView && (
          <SenseView
            bubbles={ws.senseBubbles}
            expandedKey={ws.expanded.kind === "sense" ? ws.expanded.key : null}
            expand={ws.senseExpand}
            hoveredId={ws.hoveredId}
            onToggle={ws.toggleSenseExpand}
            onExpandFileDown={ws.onExpandFileDown}
            setHover={ws.setHover}
            openDrawer={ws.openDrawer}
            deletePhoto={ws.deletePhoto}
          />
        )}
      </PanZoomCanvas>

      {ws.isTimelineView && <TimelineHeader layout={ws.timelineLayout} tx={ws.tx} scale={ws.scale} />}

      {ws.isMapView && (
        <MapView
          photos={ws.projectPhotos}
          contentLeft={contentLeft}
          expanded={ws.expanded}
          expandOverrides={ws.expandOverrides}
          hoveredId={ws.hoveredId}
          onToggleMapExpand={ws.toggleMapExpand}
          onCloseExpand={ws.closeExpand}
          onExpandFileDown={ws.onExpandFileDown}
          setHover={ws.setHover}
          openDrawer={ws.openDrawer}
          deletePhoto={ws.deletePhoto}
        />
      )}

      <AppHeader
        projLabel={ws.projLabel}
        zoomPct={ws.zoomPct}
        onZoomReset={ws.onZoomReset}
        onOpenProj={ws.openProj}
        onOpenAcct={ws.openAcct}
        viewTabs={<ViewTabs show={ws.showViewTabs} view={ws.view} onSelect={ws.setView} />}
      />

      <ProjectDropdown
        open={ws.projOpen}
        isAll={ws.projCurrent === "all"}
        list={ws.projectList}
        onClose={ws.closeProj}
        onSelectAll={() => ws.selectProject("all")}
        onSelect={ws.selectProject}
      />

      <AccountDropdown open={ws.acctOpen} onClose={ws.closeAcct} onFlashToast={ws.flashToast} />

      <LeftSidebar
        expanded={ws.sidebarExpanded}
        onToggle={ws.toggleSidebar}
        chatOpen={ws.chatOpen}
        searchOpen={ws.search}
        onOpenSearch={ws.openSearch}
        onToggleChat={ws.toggleChat}
        onOpenHelp={ws.openHelp}
        photoCount={ws.photos.length}
        onFlashToast={ws.flashToast}
      />

      <ChatPanel
        open={ws.chatOpen}
        sidebarW={sidebarW}
        msgs={ws.chatMsgs}
        input={ws.chatInput}
        onClose={ws.closeChat}
        onInput={ws.onChatInput}
        onKey={ws.onChatKey}
        onSend={ws.sendChat}
      />

      <BottomToolbar
        tool={ws.tool}
        showCanvasTools={showCanvasTools}
        showAddToProject={ws.showAddToProject}
        selCount={ws.selectedIds.size}
        zoomPct={ws.zoomPct}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onAdd={ws.addToolbar}
        onFit={ws.onFit}
        onZoomReset={ws.onZoomReset}
        onAddToProject={ws.toggleAddProj}
      />

      <AddToProjectPopover
        open={ws.addProjOpen}
        onClose={ws.closeAddProj}
        onSelect={ws.addToProject}
        onCreateNew={ws.createNewProject}
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
        onToggleCaptions={ws.toggleBulkCaptions}
        onToggleTags={ws.toggleBulkTags}
        onToggleFaces={ws.toggleBulkFaces}
        onToggleLang={ws.toggleBulkLang}
        onSetStyle={ws.setBulkStyle}
        onRun={ws.runBulk}
      />

      <ImportDropdown open={ws.impOpen} onUpload={ws.doUpload} />

      <SearchModal open={ws.search} onClose={ws.closeSearch} />

      <HelpModal open={ws.helpOpen} onClose={ws.closeHelp} onSend={sendHelpTicket} />

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
