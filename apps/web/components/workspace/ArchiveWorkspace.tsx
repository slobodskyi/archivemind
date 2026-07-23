"use client";

import type { CanvasGroup } from "@archivemind/shared";
import type { Photo } from "@/types";
import { useWorkspace, type ProjectOption } from "@/hooks/useWorkspace";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import FrameOverlay from "@/components/canvas/FrameOverlay";
import FolderOverlay from "@/components/canvas/FolderOverlay";
import StickyNoteOverlay from "@/components/canvas/StickyNoteOverlay";
import ProjectAssetView from "@/components/canvas/ProjectAssetView";
import CloudDecor, { CloudLabels } from "@/components/canvas/CloudDecor";
import GeoMapPane from "@/components/map/GeoMapPane";
import AppHeader from "@/components/header/AppHeader";
import ViewTabs from "@/components/header/ViewTabs";
import WorkspaceToggle from "@/components/header/WorkspaceToggle";
import ProjectDropdown from "@/components/header/ProjectDropdown";
import ZoomDropdown from "@/components/header/ZoomDropdown";
import AccountDropdown from "@/components/header/AccountDropdown";
import ChatPanel from "@/components/chat/ChatPanel";
import LeftToolbar from "@/components/toolbar/LeftToolbar";
import WorkspaceActionBar from "@/components/toolbar/WorkspaceActionBar";
import Minimap from "@/components/toolbar/Minimap";
import TrashPanel from "@/components/trash/TrashPanel";
import AddToProjectPopover from "@/components/toolbar/AddToProjectPopover";
import CanvasContextMenu from "@/components/canvas/CanvasContextMenu";
import SourceBrowserSidebar from "@/components/sidebar/SourceBrowserSidebar";
import BulkAiPanel from "@/components/bulk-ai/BulkAiPanel";
import PhotoDrawer from "@/components/drawer/PhotoDrawer";
import ImageEditor from "@/components/editor/ImageEditor";
import SearchModal from "@/components/modals/SearchModal";
import ExportDialog from "@/components/export/ExportDialog";
import ImportModal from "@/components/import/ImportModal";
import UploadManager from "@/components/upload/UploadManager";
import Toast from "@/components/modals/Toast";
import ConfirmModal from "@/components/modals/ConfirmModal";

interface ArchiveWorkspaceProps {
  initialPhotos: Photo[];
  workspaceId: string;
  projects: ProjectOption[];
  currentProjectId: string;
  initialGroups: CanvasGroup[];
}

export default function ArchiveWorkspace({
  initialPhotos,
  workspaceId,
  projects,
  currentProjectId,
  initialGroups,
}: ArchiveWorkspaceProps) {
  const ws = useWorkspace(initialPhotos, workspaceId, projects, currentProjectId, initialGroups);

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
        onCanvasContext={(e) => {
          e.preventDefault();
          ws.openContextMenu(e.clientX, e.clientY, null);
        }}
        canvasCursor={ws.canvasCursor}
        canvasTransform={ws.canvasTransform}
        animating={ws.tilesAnimating}
        marquee={ws.marquee}
      >
        <FrameOverlay
          frames={ws.frames}
          draft={ws.frameDraft}
          onDeleteFrame={ws.deleteFrame}
          onRenameFrame={ws.renameFrame}
        />
        <FolderOverlay
          folders={ws.folders}
          scale={ws.scale}
          onToggle={ws.toggleFolder}
          onMove={ws.moveGroup}
          onRename={ws.renameGroup}
          onDelete={ws.deleteGroup}
        />
        <StickyNoteOverlay
          notes={ws.stickyNotes}
          onDragStart={ws.onStickyDown}
          onTextChange={ws.updateStickyText}
          onDelete={ws.deleteStickyNote}
        />
        {/* Grouping views draw their colored backdrop + connecting lines behind
            the tiles; the tiles themselves are the same persistent set in every
            view, so switching a sort just reflows (animates) their positions. */}
        {ws.cloudDecor && <CloudDecor layout={ws.cloudDecor} edgesReady={!ws.tilesAnimating} focusedCloudKey={ws.focusedCloudKey} />}
        <ProjectAssetView
          photos={ws.projectPhotos}
          previews={ws.uploadPreviews}
          positions={ws.activePositions}
          previewPositions={ws.projectAssetPositions}
          selectedIds={ws.selectedIds}
          hoveredId={ws.hoveredId}
          animating={ws.tilesAnimating}
          focusedCloudKey={ws.focusedCloudKey}
          tileCloud={ws.tileCloud}
          onTileDown={ws.onTileDown}
          setHover={ws.setHover}
          openDrawer={ws.openDrawer}
          deletePhoto={ws.deletePhoto}
          openContextMenu={ws.openContextMenu}
        />
        {ws.cloudDecor && <CloudLabels layout={ws.cloudDecor} focusedCloudKey={ws.focusedCloudKey} onCloudLabelDown={ws.onCloudLabelDown} />}
      </PanZoomCanvas>

      {/* MAP is the one view that is not a sort of the canvas tiles — it is a
          real geographic map over its own basemap (ADR 0027), so it covers the
          canvas rather than reflowing it. */}
      {ws.isMapView && (
        <GeoMapPane
          photos={ws.projectPhotos}
          selectedIds={ws.selectedIds}
          onOpenAsset={ws.openDrawer}
          onSelectAssets={ws.selectSearchResults}
        />
      )}

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

      <AppHeader
        projLabel={ws.projLabel}
        onHome={ws.goHome}
        onOpenProj={ws.openProj}
        showZoomControl
        zoomPct={ws.zoomPct}
        onToggleZoomMenu={ws.toggleZoomMenu}
        canUndo={ws.canUndo}
        canRedo={ws.canRedo}
        onUndo={ws.undo}
        onRedo={ws.redo}
        onFlashToast={ws.flashToast}
        onOpenAcct={ws.openAcct}
        viewTabs={<ViewTabs show={ws.showViewTabs} view={ws.view} onSelect={ws.setView} />}
        afterProject={
          ws.projectMode ? (
            <WorkspaceToggle active={ws.view === "neural"} onSelect={() => ws.setView("neural")} />
          ) : undefined
        }
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
        onOpenResult={ws.openDrawer}
        onSelectResults={ws.selectSearchResults}
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
        onOpenSearch={ws.openSearch}
        onToggleChat={ws.toggleChat}
        onToggleBulkPanel={ws.toggleBulkPanel}
        onExtractExif={ws.extractExif}
        onAdd={ws.addToolbar}
        onAddStickyNote={ws.addStickyNote}
        onToggleTrash={ws.toggleTrash}
        trashOpen={ws.trashOpen}
        onFit={ws.onFit}
        onZoomReset={ws.onZoomReset}
        onAddToProject={ws.toggleAddProj}
      />

      <TrashPanel
        open={ws.trashOpen}
        assets={ws.trashAssets}
        onClose={ws.closeTrash}
        onRestore={ws.restoreFromTrash}
        onPurge={ws.purgeFromTrash}
      />

      {/* Workspace-only bottom action bar — hosts the artboard tool (moved off
          the left toolbar) plus selection actions. Absent on the sorting views. */}
      {ws.view === "neural" && ws.projectMode && (
        <WorkspaceActionBar
          tool={ws.tool}
          selCount={ws.selectedIds.size}
          onArtboard={ws.toolFrame}
          onTidy={ws.tidyUp}
          onCopy={ws.copyFiles}
          onDuplicate={ws.duplicateFiles}
          onExport={ws.exportFiles}
          onGroup={ws.groupFiles}
          onDelete={ws.deleteSelected}
        />
      )}

      <Minimap minimap={ws.minimap} onDown={ws.onMinimapDown} right={ws.minimapRight} />

      <AddToProjectPopover
        open={ws.addProjOpen}
        list={ws.projectList}
        onClose={ws.closeAddProj}
        onSelect={ws.addToProject}
        onCreateNew={ws.createNewProject}
        artboards={ws.frames.map((f) => ({ key: f.id, label: f.label }))}
        onSelectArtboard={(id) => {
          ws.closeAddProj();
          ws.addToExistingArtboard(id);
        }}
        onCreateArtboard={() => {
          ws.closeAddProj();
          ws.addToNewArtboard();
        }}
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

      {ws.exportOpen && <ExportDialog assetIds={Array.from(ws.selectedIds)} onClose={ws.closeExport} />}

      <CanvasContextMenu
        menu={ws.contextMenu}
        allFilesMode={ws.allFilesMode}
        selCount={ws.selectedIds.size}
        onClose={ws.closeContextMenu}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onOpenSearch={ws.openSearch}
        onToggleChat={ws.toggleChat}
        onToggleBulkPanel={ws.toggleBulkPanel}
        onExtractExif={ws.extractExif}
        onAdd={ws.addToolbar}
        onAddStickyNote={ws.addStickyNote}
        onDelete={ws.deleteFromContext}
        onFit={ws.onFit}
      />

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
        onSaveCaption={ws.saveCaption}
        onEditImage={() => ws.drawerPhoto && ws.openEditor(ws.drawerPhoto.id)}
        onDelete={() => ws.drawerPhoto && ws.deletePhoto(ws.drawerPhoto.id)}
      />

      <ImageEditor
        open={ws.editorOpen}
        photo={ws.editorPhoto}
        busy={ws.editBusy}
        onClose={ws.closeEditor}
        onSave={ws.saveEdit}
        onReset={ws.resetEdit}
      />

      {/* Big-selection delete guardrail (ADR 0033) — the same modal projects
          use, with copy that matches the real behavior: trash + 30 days. */}
      <ConfirmModal
        open={ws.confirmDeleteCount > 0}
        title={`Delete ${ws.confirmDeleteCount} files?`}
        body={`${ws.confirmDeleteCount} files will move to Trash and be permanently removed after 30 days. You can restore them from Trash until then.`}
        confirmLabel="Move to Trash"
        danger
        onConfirm={ws.confirmDeleteNow}
        onClose={ws.cancelConfirmDelete}
      />

      {/* Action toasts (delete → Undo) render as the quiet bottom-left chip —
          they fire on every delete during normal culling and must not shout
          from the canvas center; plain confirmations/errors keep the
          attention spot under the header. */}
      <Toast
        show={ws.toast.show}
        text={ws.toast.text}
        actionLabel={ws.toast.actionLabel}
        onAction={ws.toast.onAction}
        variant={ws.toast.actionLabel ? "quiet" : "default"}
      />
    </div>
  );
}
