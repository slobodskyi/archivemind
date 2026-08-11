"use client";

import { useEffect } from "react";
import type { AssetLabel, CanvasAnnotation, CanvasGroup, LabelNames } from "@archivemind/shared";
import type { Photo } from "@/types";
import { useWorkspace, type ProjectOption } from "@/hooks/useWorkspace";
import { useBoards } from "@/hooks/useBoards";
import { LABEL_COLORS } from "@/lib/labels";
import BoardBrowser from "@/components/header/BoardBrowser";
import FolderOverlay from "@/components/canvas/FolderOverlay";
import StickyNoteOverlay from "@/components/canvas/StickyNoteOverlay";
import WorkspaceActionBar from "@/components/toolbar/WorkspaceActionBar";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import ProjectAssetView from "@/components/canvas/ProjectAssetView";
import CloudDecor, { CloudLabels } from "@/components/canvas/CloudDecor";
import GeoMapPane from "@/components/map/GeoMapPane";
import AppHeader from "@/components/header/AppHeader";
import ViewSwitcher from "@/components/toolbar/ViewSwitcher";
import ProjectDropdown from "@/components/header/ProjectDropdown";
import ZoomDropdown from "@/components/header/ZoomDropdown";
import AccountDropdown from "@/components/header/AccountDropdown";
import ChatPanel from "@/components/chat/ChatPanel";
import LeftToolbar from "@/components/toolbar/LeftToolbar";
import SortingActionBar from "@/components/toolbar/SortingActionBar";
import Minimap from "@/components/toolbar/Minimap";
import TrashPanel from "@/components/trash/TrashPanel";
import AddToProjectPopover from "@/components/toolbar/AddToProjectPopover";
import CanvasContextMenu from "@/components/canvas/CanvasContextMenu";
import SourceBrowserSidebar from "@/components/sidebar/SourceBrowserSidebar";
import BulkAiPanel from "@/components/bulk-ai/BulkAiPanel";
import PhotoDrawer from "@/components/drawer/PhotoDrawer";
import ImageEditor from "@/components/editor/ImageEditor";
import ExportDialog from "@/components/export/ExportDialog";
import ImportModal from "@/components/import/ImportModal";
import UploadManager from "@/components/upload/UploadManager";
import Toast from "@/components/modals/Toast";
// SearchModal retired — the magnifier now opens the real Smart Search panel (ChatPanel).
import ConfirmModal from "@/components/modals/ConfirmModal";

interface Account {
  initials: string;
  name: string;
  email: string;
}

interface ArchiveWorkspaceProps {
  initialPhotos: Photo[];
  workspaceId: string;
  projects: ProjectOption[];
  currentProjectId: string;
  initialGroups: CanvasGroup[];
  /** The workspace's colour-label names (defaults with renames applied). */
  initialLabelNames: LabelNames;
  /** Sticky notes (and later ink) for this scope — ADR 0041. Server-read so the
   *  first paint already has them, like initialGroups. */
  initialAnnotations: CanvasAnnotation[];
  account: Account;
}

export default function ArchiveWorkspace({
  initialPhotos,
  workspaceId,
  projects,
  currentProjectId,
  initialGroups,
  initialLabelNames,
  initialAnnotations,
  account,
}: ArchiveWorkspaceProps) {
  // Workspaces (boards) — the entity that replaced artboards (ADR 0044). A board
  // scopes the canvas to its files and turns it into a working surface; with no
  // board open you're in the sorting views over the whole project.
  const bd = useBoards(currentProjectId);
  const boardMode = bd.activeBoardId !== null;

  const ws = useWorkspace(
    initialPhotos,
    workspaceId,
    projects,
    currentProjectId,
    initialGroups,
    initialLabelNames,
    initialAnnotations,
    bd.scopeIds,
  );

  // A board is a single working canvas — force the Canvas (neural) view while one
  // is open; the sorting views (Timeline/Topic/Map) belong to "All files".
  const { setView } = ws;
  useEffect(() => {
    if (boardMode) setView("neural");
  }, [boardMode, setView]);

  const boardCounts: Record<string, number> = {};
  for (const b of bd.boards) {
    const ids = new Set(b.assetIds);
    boardCounts[b.id] = ws.photos.filter((p) => ids.has(p.id)).length;
  }

  // The colour the label pickers should ring: what the whole target carries, or
  // "mixed" when it disagrees. Target = the selection, else the right-clicked
  // tile — the same selection-first rule the pickers themselves apply.
  const labelTargetIds = ws.selectedIds.size > 0
    ? [...ws.selectedIds]
    : ws.contextMenu?.targetId
      ? [ws.contextMenu.targetId]
      : [];
  const targetLabels = new Set(
    labelTargetIds.map((id) => ws.photos.find((p) => p.id === id)?.label ?? null),
  );
  const currentLabel: AssetLabel | "mixed" | null =
    targetLabels.size === 1 ? ([...targetLabels][0] ?? null) : targetLabels.size > 1 ? "mixed" : null;

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        // dvh, not vh: on iOS `100vh` is the LARGE viewport, so the bottom
        // action bars (bottom: 20) sat underneath Safari's own toolbar and were
        // unreachable until the chrome happened to collapse.
        height: "100dvh",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* A Workspace (board) canvas uses a lines grid; the sorting/browse views
          use dots, so the two surfaces read apart by design (ADR 0044). */}
      <InfiniteGrid gridSize={ws.gridSize} gridPos={ws.gridPos} gridOpacity={ws.gridOpacity} variant={boardMode ? "lines" : "dots"} />

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
        {/* The working overlays (folders, sticky notes) live on a Workspace
            (board) canvas now, not the sorting views (ADR 0044). Artboards are
            gone — a whole board is the working region a sub-frame used to be. */}
        {boardMode && (
          <>
            <FolderOverlay
              folders={ws.folders}
              scale={ws.scale}
              openFolderId={ws.openFolderId}
              onOpen={ws.openFolder}
              onClose={ws.closeFolder}
              onOpenPhoto={(id) => {
                ws.closeFolder();
                ws.openDrawer(id);
              }}
              onDropMemberOut={ws.dropMemberOnCanvas}
              onMove={ws.moveGroup}
              onRename={ws.renameGroup}
              onDelete={ws.deleteGroup}
            />
            <StickyNoteOverlay
              notes={ws.stickyNotes}
              labelNames={ws.labelNames}
              onDragStart={ws.onStickyDown}
              onResizeStart={ws.onStickyResizeDown}
              onTextChange={ws.updateStickyText}
              onColorChange={ws.setStickyColor}
              onFontSizeChange={ws.setStickyFontSize}
              onToggleCheck={ws.toggleStickyCheck}
              onSetStrokes={ws.setStickyStrokes}
              onDelete={ws.deleteStickyNote}
            />
          </>
        )}
        {/* Grouping views draw their colored backdrop + connecting lines behind
            the tiles; the tiles themselves are the same persistent set in every
            view, so switching a sort just reflows (animates) their positions. */}
        {ws.cloudDecor && (
          <CloudDecor
            layout={ws.cloudDecor}
            edgesReady={!ws.tilesAnimating}
            focusedCloudKey={ws.focusedCloudKey}
            dropTargetKey={ws.isSenseView ? ws.topicDropTargetKey : null}
          />
        )}
        <ProjectAssetView
          // visiblePhotos, not projectPhotos: the label filter narrows what is
          // DRAWN while every layout above still runs over the full set, so a
          // filter can never move a tile that survives it.
          photos={ws.visiblePhotos}
          previews={ws.visiblePreviews}
          positions={ws.activePositions}
          previewPositions={ws.projectAssetPositions}
          selectedIds={ws.selectedIds}
          hoveredId={ws.hoveredId}
          animating={ws.tilesAnimating}
          zOrder={ws.tileZ}
          focusedCloudKey={ws.focusedCloudKey}
          tileCloud={ws.tileCloud}
          aiBusyIds={ws.aiBusyIds}
          onTileDown={ws.onTileDown}
          setHover={ws.setHover}
          openDrawer={ws.openDrawer}
          deletePhoto={ws.deletePhoto}
          openContextMenu={ws.openContextMenu}
          analyzePhoto={ws.analyzePhoto}
          labelNames={ws.labelNames}
        />
        {ws.cloudDecor && (
          <CloudLabels
            layout={ws.cloudDecor}
            focusedCloudKey={ws.focusedCloudKey}
            onCloudLabelDown={ws.onCloudLabelDown}
            // Two views can rename a cloud, and a rename means a different thing
            // in each: on Topic it pins a cluster's name (ADR 0038), on LABELS it
            // renames the colour for the whole workspace. Timeline's labels are
            // dates and rename nothing.
            onRenameCloud={
              ws.isSenseView
                ? (cloud, name) => cloud.clusterId && ws.renameCloud(cloud.clusterId, name)
                : undefined
            }
            canRenameCloud={
              ws.isSenseView
                ? // Only a cloud backed by exactly ONE stored cluster: two
                  // clusters sharing a label draw as one cloud, and renaming
                  // "it" would silently rename half of it.
                  (cloud) => !!cloud.clusterId
                : undefined
            }
            dropTargetKey={ws.isSenseView ? ws.topicDropTargetKey : null}
            dropCount={ws.selectedIds.size}
          />
        )}
      </PanZoomCanvas>

      {/* MAP is the one view that is not a sort of the canvas tiles — it is a
          real geographic map over its own basemap (ADR 0027), so it covers the
          canvas rather than reflowing it. */}
      {ws.isMapView && (
        <GeoMapPane
          photos={ws.visiblePhotos}
          selectedIds={ws.selectedIds}
          onOpenAsset={ws.openDrawer}
          onSelectAssets={ws.selectSearchResults}
        />
      )}

      {/* Filtered down to nothing. Distinct from the empty state below on
          purpose: a canvas hiding every file must say WHY and offer the way
          back, or it is indistinguishable from an archive that lost its
          contents. */}
      {ws.labelFilter && ws.visiblePhotos.length === 0 && ws.projectPhotos.length > 0 && (
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
            {ws.labelFilter === "none"
              ? "Everything here is labelled"
              : `Nothing marked ${ws.labelNames[ws.labelFilter]}`}
          </div>
          <button
            onClick={ws.clearLabelFilter}
            style={{
              pointerEvents: "auto",
              marginTop: 2,
              height: 30,
              padding: "0 14px",
              background: "transparent",
              color: "var(--t1)",
              border: "1px solid var(--bdh)",
              borderRadius: 2,
              fontSize: 12,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Clear filter
          </button>
        </div>
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
          <div style={{ fontSize: 11.5, color: "var(--t2)" }}>
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
        showZoomControl={!ws.isMapView}
        zoomPct={ws.zoomPct}
        onToggleZoomMenu={ws.toggleZoomMenu}
        canUndo={ws.canUndo}
        canRedo={ws.canRedo}
        onUndo={ws.undo}
        onRedo={ws.redo}
        onFlashToast={ws.flashToast}
        onOpenAcct={ws.openAcct}
        accountInitials={account.initials}
        accountName={account.name}
        afterProject={
          ws.projectMode ? (
            <BoardBrowser
              boards={bd.boards}
              activeBoardId={bd.activeBoardId}
              counts={boardCounts}
              onSelect={bd.selectBoard}
              onCreate={() => bd.createBoard()}
              onRename={bd.renameBoard}
              onDelete={bd.deleteBoard}
            />
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

      <AccountDropdown open={ws.acctOpen} account={account} onClose={ws.closeAcct} onFlashToast={ws.flashToast} />

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
        isMapView={ws.isMapView}
        showAddToProject={ws.showAddToProject}
        selCount={ws.selectedIds.size}
        zoomPct={ws.zoomPct}
        searchOpen={ws.chatOpen}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onOpenSearch={ws.toggleChat}
        onAdd={ws.addToolbar}
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

      {/* A Workspace (board) canvas gets the full working action bar; the sorting
          views get the narrow organize bar. Never both. */}
      {boardMode && (
        <WorkspaceActionBar
          selCount={ws.selectedIds.size}
          aiOpen={ws.bulkPanelOpen}
          onTidy={ws.tidyUp}
          onAi={ws.toggleBulkPanel}
          onCopy={ws.copyFiles}
          onExport={ws.exportFiles}
          onGroup={ws.groupFiles}
          onFolder={ws.folderFiles}
          onAddStickyNote={ws.addStickyNote}
          onDelete={ws.deleteSelected}
          labelNames={ws.labelNames}
          labelMenuOpen={ws.labelMenuOpen}
          selectionLabel={currentLabel}
          labelFilter={ws.labelFilter}
          onToggleLabelMenu={ws.toggleLabelMenu}
          onPickLabel={(label) => ws.labelSelection(label)}
          onSetFilter={ws.setLabelFilter}
        />
      )}

      {/* One sorting tools panel above the switcher, for every sorting view in a
          project. Colour-label control on all four; Regroup on Canvas / Timeline /
          Topic (not Map); the Topic editor on Topic only. */}
      {ws.projectMode && !boardMode && (
        <SortingActionBar
          showRegroup={!ws.isMapView}
          showRecluster={ws.isSenseView}
          canRegroup={ws.canRegroup}
          selCount={ws.selectedIds.size}
          onRegroup={ws.regroupClouds}
          topicMembership={
            ws.isSenseView
              ? {
                  targets: ws.topicOptions,
                  currentTopicId: ws.selectedTopicId,
                  canReturnToAi: ws.canReturnSelectionToAi,
                  busy: ws.topicMutationBusy,
                  onMove: ws.moveSelectionToTopic,
                  onCreate: ws.createTopicFromSelection,
                  onReturnToAi: ws.returnSelectionToAi,
                }
              : undefined
          }
          labelNames={ws.labelNames}
          labelMenuOpen={ws.labelMenuOpen}
          selectionLabel={currentLabel}
          labelFilter={ws.labelFilter}
          onToggleLabelMenu={ws.toggleLabelMenu}
          onPickLabel={(label) => ws.labelSelection(label)}
          onSetFilter={ws.setLabelFilter}
        />
      )}

      {/* The bottom view switcher — only in "All files" (sorting) mode; inside a
          Workspace you're on its single working canvas. */}
      <ViewSwitcher show={ws.showViewTabs && !boardMode} view={ws.view} onSelect={ws.setView} />

      {/* Map is its own MapLibre surface (ADR 0027) — the canvas minimap would
          show/pan the hidden neural grid and physically cover MapLibre's own
          zoom control, so it (and the header zoom/Fit) is suppressed on Map. */}
      {!ws.isMapView && <Minimap minimap={ws.minimap} onDown={ws.onMinimapDown} right={ws.minimapRight} />}

      <AddToProjectPopover
        open={ws.addProjOpen}
        list={ws.projectList}
        onClose={ws.closeAddProj}
        onSelect={ws.addToProject}
        onCreateNew={ws.createNewProject}
        workspaces={bd.boards.map((b) => ({ key: b.id, label: b.name, color: LABEL_COLORS[b.color] }))}
        onSelectWorkspace={(id) => {
          bd.addToBoard(id, [...ws.selectedIds]);
          ws.flashToast("Added to workspace");
          ws.closeAddProj();
        }}
        onCreateWorkspace={() => {
          bd.createBoard(undefined, [...ws.selectedIds]);
          ws.closeAddProj();
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
        selectedIds={ws.bulkSelectedIds}
        thumbs={ws.bulkThumbs}
        bulkOps={ws.bulkOps}
        bulkLangs={ws.bulkLangs}
        bulkStyle={ws.bulkStyle}
        proc={ws.proc}
        onClear={ws.clearSelection}
        onToggleCaptions={ws.toggleBulkCaptions}
        onToggleTags={ws.toggleBulkTags}
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

      {ws.exportOpen && (
        <ExportDialog
          assetIds={ws.exportIds}
          photos={ws.photos}
          defaultTitle={ws.projLabel === "Projects" ? "" : ws.projLabel}
          workspaceId={workspaceId}
          onClose={ws.closeExport}
        />
      )}

      <CanvasContextMenu
        menu={ws.contextMenu}
        allFilesMode={ws.allFilesMode}
        isCanvasView={ws.view === "neural"}
        selCount={ws.selectedIds.size}
        onClose={ws.closeContextMenu}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onToggleChat={ws.toggleChat}
        onToggleBulkPanel={ws.toggleBulkPanel}
        onExtractExif={ws.extractExif}
        onAdd={ws.addToolbar}
        onAddStickyNote={ws.addStickyNote}
        onPaste={ws.pasteFiles}
        clipboardCount={ws.clipboardCount}
        onGroup={ws.groupFiles}
        onUngroup={ws.ungroupSelection}
        hasGroup={ws.selectionHasGroup}
        onBringToFront={ws.bringToFront}
        onBringForward={ws.bringForward}
        onSendBackward={ws.sendBackward}
        onSendToBack={ws.sendToBack}
        onDelete={ws.deleteFromContext}
        onFit={ws.onFit}
        labelNames={ws.labelNames}
        currentLabel={currentLabel}
        onPickLabel={(label) => ws.labelSelection(label, ws.contextMenu?.targetId ?? null)}
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
        onSaveExif={ws.saveExif}
        onRevertExif={ws.revertExif}
        onEditImage={() => ws.drawerPhoto && ws.openEditor(ws.drawerPhoto.id)}
        onDelete={() => ws.drawerPhoto && ws.deletePhoto(ws.drawerPhoto.id)}
        onSetFactStatus={ws.setFactStatus}
        onExport={() => ws.drawerPhoto && ws.openExportFor([ws.drawerPhoto.id])}
        labelNames={ws.labelNames}
        // The drawer is about ONE photo, so it labels that photo even when a
        // selection is live — passing its id as the fallback would let a
        // stale canvas selection swallow the click.
        onPickLabel={(label) => ws.drawerPhoto && ws.labelOne(ws.drawerPhoto.id, label)}
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
