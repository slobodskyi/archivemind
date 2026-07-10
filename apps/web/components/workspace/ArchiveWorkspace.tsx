"use client";

import type { Photo } from "@/types";
import { useWorkspace } from "@/hooks/useWorkspace";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import FrameOverlay from "@/components/canvas/FrameOverlay";
import StickyNoteOverlay from "@/components/canvas/StickyNoteOverlay";
import NeuralView from "@/components/canvas/NeuralView";
import TimelineView from "@/components/canvas/TimelineView";
import TimelineHeader from "@/components/canvas/TimelineHeader";
import SenseView from "@/components/canvas/SenseView";
import MapView from "@/components/map/MapView";
import AppHeader from "@/components/header/AppHeader";
import ViewTabs from "@/components/header/ViewTabs";
import ProjectDropdown from "@/components/header/ProjectDropdown";
import ZoomDropdown, { MAP_ZOOM_PRESETS } from "@/components/header/ZoomDropdown";
import AccountDropdown from "@/components/header/AccountDropdown";
import ChatPanel from "@/components/chat/ChatPanel";
import LeftToolbar from "@/components/toolbar/LeftToolbar";
import Minimap from "@/components/toolbar/Minimap";
import AddToProjectPopover from "@/components/toolbar/AddToProjectPopover";
import SourceBrowserSidebar from "@/components/sidebar/SourceBrowserSidebar";
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
        {!ws.isMapView && (
          <FrameOverlay
            frames={ws.frames}
            draft={ws.frameDraft}
            onDeleteFrame={ws.deleteFrame}
            onRenameFrame={ws.renameFrame}
          />
        )}
        {!ws.isMapView && (
          <StickyNoteOverlay
            notes={ws.stickyNotes}
            onDragStart={ws.onStickyDown}
            onTextChange={ws.updateStickyText}
            onDelete={ws.deleteStickyNote}
          />
        )}
        {ws.isNeural && (
          <NeuralView
            photos={ws.photos}
            galleryOverrides={ws.galleryOverrides}
            onGalleryNodeDown={ws.onGalleryNodeDown}
            onHubOpen={ws.openSourceTab}
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
          contentLeft={ws.contentLeft}
          drawerRight={ws.drawerRight}
          expanded={ws.expanded}
          expandOverrides={ws.expandOverrides}
          hoveredId={ws.hoveredId}
          onToggleMapExpand={ws.toggleMapExpand}
          onCloseExpand={ws.closeExpand}
          onExpandFileDown={ws.onExpandFileDown}
          setHover={ws.setHover}
          openDrawer={ws.openDrawer}
          deletePhoto={ws.deletePhoto}
          onMapReady={ws.registerMapApi}
          onZoomChange={ws.onMapZoomChange}
        />
      )}

      <AppHeader
        isAll={ws.projCurrent === "all"}
        projLabel={ws.projLabel}
        onRootClick={ws.projCurrent === "all" ? ws.openProj : () => ws.selectProject("all")}
        onOpenProj={ws.openProj}
        showZoomControl={!ws.isTimelineView}
        zoomPct={ws.zoomPct}
        onToggleZoomMenu={ws.toggleZoomMenu}
        canUndo={ws.canUndo}
        canRedo={ws.canRedo}
        onUndo={ws.undo}
        onRedo={ws.redo}
        onOpenHelp={ws.openHelp}
        onFlashToast={ws.flashToast}
        onOpenAcct={ws.openAcct}
        viewTabs={<ViewTabs show={ws.showViewTabs} view={ws.view} onSelect={ws.setView} />}
      />

      <ZoomDropdown
        open={ws.zoomMenuOpen}
        zoomPct={ws.zoomPct}
        onClose={ws.closeZoomMenu}
        onSelectPct={ws.setZoomPct}
        onFit={ws.onFit}
        presets={ws.isMapView ? MAP_ZOOM_PRESETS : undefined}
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

      <ChatPanel
        open={ws.chatOpen}
        msgs={ws.chatMsgs}
        input={ws.chatInput}
        onClose={ws.closeChat}
        onInput={ws.onChatInput}
        onKey={ws.onChatKey}
        onSend={ws.sendChat}
      />

      <LeftToolbar
        tool={ws.tool}
        allFilesMode={ws.allFilesMode}
        showAddToProject={ws.showAddToProject}
        selCount={ws.selectedIds.size}
        zoomPct={ws.zoomPct}
        searchOpen={ws.search}
        chatOpen={ws.chatOpen}
        bulkPanelOpen={ws.bulkPanelOpen}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onFrameTool={ws.toolFrame}
        onOpenSearch={ws.openSearch}
        onToggleChat={ws.toggleChat}
        onToggleBulkPanel={ws.toggleBulkPanel}
        onExtractExif={ws.extractExif}
        onAdd={ws.addToolbar}
        onAddStickyNote={ws.addStickyNote}
        onFit={ws.onFit}
        onZoomReset={ws.onZoomReset}
        onAddToProject={ws.toggleAddProj}
      />

      <Minimap minimap={ws.minimap} onDown={ws.onMinimapDown} right={ws.drawerRight} />

      <AddToProjectPopover
        open={ws.addProjOpen}
        list={ws.projectList}
        onClose={ws.closeAddProj}
        onSelect={ws.addToProject}
        onCreateNew={ws.createNewProject}
      />

      <SourceBrowserSidebar
        open={ws.sidebarOpen}
        tabs={ws.sidebarTabs}
        activeTab={ws.sidebarActiveTab}
        photos={ws.photos}
        selectedIds={ws.sidebarSelectedIds}
        searchText={ws.sidebarSearchText}
        addOpen={ws.sidebarAddOpen}
        projectList={ws.projectList}
        right={ws.drawerRight}
        onSelectTab={ws.setSidebarActiveTab}
        onCloseTab={ws.closeSourceTab}
        onClose={ws.closeSidebar}
        onToggleFile={ws.toggleSidebarFile}
        onOpenFile={ws.openDrawer}
        onToggleGroup={ws.toggleSidebarGroup}
        onSearchChange={ws.setSidebarSearch}
        onToggleAddOpen={ws.toggleSidebarAddOpen}
        onCloseAddOpen={ws.closeSidebarAddOpen}
        onSelectProject={ws.sidebarAddToProject}
        onCreateProject={ws.sidebarCreateProject}
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
        right={ws.drawerRight}
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
