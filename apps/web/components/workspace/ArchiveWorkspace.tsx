"use client";

import type { Photo } from "@/types";
import { useWorkspace, type ProjectOption } from "@/hooks/useWorkspace";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import FrameOverlay from "@/components/canvas/FrameOverlay";
import StickyNoteOverlay from "@/components/canvas/StickyNoteOverlay";
import ProjectAssetView from "@/components/canvas/ProjectAssetView";
import ColumnGridView from "@/components/canvas/ColumnGridView";
import ColumnHeader from "@/components/canvas/ColumnHeader";
import CloudView from "@/components/canvas/CloudView";
import AppHeader from "@/components/header/AppHeader";
import ViewTabs from "@/components/header/ViewTabs";
import ProjectDropdown from "@/components/header/ProjectDropdown";
import ZoomDropdown from "@/components/header/ZoomDropdown";
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
import ImportModal from "@/components/import/ImportModal";
import UploadManager from "@/components/upload/UploadManager";
import Toast from "@/components/modals/Toast";

interface ArchiveWorkspaceProps {
  initialPhotos: Photo[];
  workspaceId: string;
  projects: ProjectOption[];
  currentProjectId: string;
}

export default function ArchiveWorkspace({
  initialPhotos,
  workspaceId,
  projects,
  currentProjectId,
}: ArchiveWorkspaceProps) {
  const ws = useWorkspace(initialPhotos, workspaceId, projects, currentProjectId);

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
        <FrameOverlay
          frames={ws.frames}
          draft={ws.frameDraft}
          onDeleteFrame={ws.deleteFrame}
          onRenameFrame={ws.renameFrame}
        />
        <StickyNoteOverlay
          notes={ws.stickyNotes}
          onDragStart={ws.onStickyDown}
          onTextChange={ws.updateStickyText}
          onDelete={ws.deleteStickyNote}
        />
        {ws.isNeural && (
          <ProjectAssetView
            photos={ws.projectPhotos}
            previews={ws.uploadPreviews}
            positions={ws.projectAssetPositions}
            selectedIds={ws.selectedIds}
            hoveredId={ws.hoveredId}
            onAssetDown={ws.onAssetDown}
            setHover={ws.setHover}
            openDrawer={ws.openDrawer}
            deletePhoto={ws.deletePhoto}
          />
        )}
        {ws.isTimelineView && (
          <ColumnGridView
            layout={ws.timelineLayout}
            photos={ws.projectPhotos}
            selectedIds={ws.selectedIds}
            hoveredId={ws.hoveredId}
            onTileDown={ws.onTlDown}
            setHover={ws.setHover}
            openDrawer={ws.openDrawer}
            deletePhoto={ws.deletePhoto}
          />
        )}
        {ws.isMapView && (
          <CloudView
            layout={ws.mapLayout}
            photos={ws.projectPhotos}
            selectedIds={ws.selectedIds}
            hoveredId={ws.hoveredId}
            onTileDown={ws.onMapAssetDown}
            setHover={ws.setHover}
            openDrawer={ws.openDrawer}
            deletePhoto={ws.deletePhoto}
          />
        )}
        {ws.isSenseView && (
          <CloudView
            layout={ws.topicLayout}
            photos={ws.projectPhotos}
            selectedIds={ws.selectedIds}
            hoveredId={ws.hoveredId}
            onTileDown={ws.onTopicAssetDown}
            setHover={ws.setHover}
            openDrawer={ws.openDrawer}
            deletePhoto={ws.deletePhoto}
          />
        )}
      </PanZoomCanvas>

      {/* Empty state — a project emptied after creation used to render a bare
          grid with no affordance (the import modal auto-opens only for fresh
          projects). Sits under the header/toolbar chrome. */}
      {ws.projectPhotos.length === 0 && ws.uploadPreviews.length === 0 && !ws.impOpen && (
        <div
          style={{
            position: "absolute",
            inset: "52px 0 0 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            zIndex: 20,
            pointerEvents: "none",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t2)" }}>
            {ws.projCurrent === "all" ? "Your archive is empty" : "This project is empty"}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--t3)" }}>
            {ws.allFilesMode ? "Open a project to upload files" : "Drop files anywhere — or import from a source"}
          </div>
          <button
            onClick={ws.allFilesMode ? ws.goHome : ws.addToolbar}
            style={{
              pointerEvents: "auto",
              marginTop: 6,
              height: 32,
              padding: "0 14px",
              background: "var(--ac)",
              color: "#050505",
              border: 0,
              borderRadius: 2,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.04em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {ws.allFilesMode ? "View projects" : "+ Import files"}
          </button>
        </div>
      )}

      {ws.isTimelineView && <ColumnHeader layout={ws.timelineLayout} tx={ws.tx} scale={ws.scale} />}

      <AppHeader
        projLabel={ws.projLabel}
        onHome={ws.goHome}
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
      />

      <ProjectDropdown
        open={ws.projOpen}
        list={ws.projectList}
        onClose={ws.closeProj}
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

      <Minimap minimap={ws.minimap} onDown={ws.onMinimapDown} right={ws.minimapRight} />

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
        viewMode={ws.sidebarViewMode}
        right={ws.drawerRight}
        onSelectTab={ws.setSidebarActiveTab}
        onCloseTab={ws.closeSourceTab}
        onClose={ws.closeSidebar}
        onToggleFile={ws.toggleSidebarFile}
        onOpenFile={ws.openDrawer}
        onAnalyze={ws.runBulk}
        onToggleGroup={ws.toggleSidebarGroup}
        onSearchChange={ws.setSidebarSearch}
        onToggleAddOpen={ws.toggleSidebarAddOpen}
        onCloseAddOpen={ws.closeSidebarAddOpen}
        onSelectProject={ws.sidebarAddToProject}
        onCreateProject={ws.sidebarCreateProject}
        onSetViewMode={ws.setSidebarViewMode}
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

      {ws.projectMode && (
        <ImportModal
          open={ws.impOpen}
          onClose={ws.closeImport}
          projectId={ws.projCurrent}
          projectName={ws.projLabel}
          onBatchStart={ws.onUploadBatchStart}
          onBatchSettled={ws.onUploadBatchSettled}
        />
      )}

      <UploadManager
        projectId={ws.projCurrent}
        disabled={ws.impOpen || ws.allFilesMode}
        disabledMessage={ws.allFilesMode ? "OPEN A PROJECT TO UPLOAD" : undefined}
        onBatchStart={ws.onUploadBatchStart}
        onBatchSettled={ws.onUploadBatchSettled}
      />

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
