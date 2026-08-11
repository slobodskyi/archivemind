"use client";

import type { AssetLabel, CanvasAnnotation, CanvasGroup, LabelNames } from "@archivemind/shared";
import type { Photo } from "@/types";
import { useMemo } from "react";
import { LABEL_COLORS, NO_LABEL_CLOUD_KEY } from "@/lib/labels";
import { useWorkspace, type ProjectOption } from "@/hooks/useWorkspace";
import InfiniteGrid from "@/components/canvas/InfiniteGrid";
import PanZoomCanvas from "@/components/canvas/PanZoomCanvas";
import FrameOverlay from "@/components/canvas/FrameOverlay";
import FolderOverlay from "@/components/canvas/FolderOverlay";
import StickyNoteOverlay from "@/components/canvas/StickyNoteOverlay";
import InkOverlay, { LiveStroke } from "@/components/canvas/InkOverlay";
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
import SortingActionBar from "@/components/toolbar/SortingActionBar";
import WorkspaceActionBar from "@/components/toolbar/WorkspaceActionBar";
import Minimap from "@/components/toolbar/Minimap";
import TrashPanel from "@/components/trash/TrashPanel";
import AddToProjectPopover from "@/components/toolbar/AddToProjectPopover";
import CanvasContextMenu from "@/components/canvas/CanvasContextMenu";
import LabelFilterPanel from "@/components/labels/LabelFilterPanel";
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
  /** Exact active-asset count for this scope. `initialPhotos` is intentionally
   *  bounded until the canvas is virtualized (Phase 5 / #18). */
  initialPhotoTotal: number;
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
  initialPhotoTotal,
  workspaceId,
  projects,
  currentProjectId,
  initialGroups,
  initialLabelNames,
  initialAnnotations,
  account,
}: ArchiveWorkspaceProps) {
  const ws = useWorkspace(
    initialPhotos,
    workspaceId,
    projects,
    currentProjectId,
    initialGroups,
    initialLabelNames,
    initialAnnotations,
  );

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

  // A Set so InkOverlay's per-stroke memo compares by identity: an erase drag
  // fires on every pointermove, and rebuilding this inline would make each one
  // a new object and defeat the memo it exists to feed.
  const pendingEraseSet = useMemo(() => new Set(ws.pendingErase), [ws.pendingErase]);
  const hiddenPhotoCount = Math.max(0, initialPhotoTotal - initialPhotos.length);

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
        {/* Artboards, folders and sticky notes are a Workspace (neural) concept
            only — their geometry is in neural coordinates, so they'd render
            misplaced on Timeline/Topic/Labels (and Map covers the canvas
            entirely). A note pinned over one arrangement means nothing over
            another: every sorting view lays the same tiles out differently, in
            its own override bucket, so there is no position the note could be
            carried to that would still say what it said. */}
        {ws.view === "neural" && (
          <>
            <FrameOverlay
              frames={ws.frames}
              counts={ws.frameCounts}
              draft={ws.frameDraft}
              scale={ws.scale}
              onSelectFrame={ws.selectFrame}
              onExportFrame={ws.exportFrame}
              onDeleteFrame={ws.deleteFrameWithContent}
              onRenameFrame={ws.renameFrame}
              onBeginMove={ws.beginFrameMove}
              onBeginResize={ws.beginFrameResize}
              onGestureMove={ws.frameGestureMove}
              onEndGesture={ws.endFrameGesture}
            />
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
            {/* Ink sits UNDER the notes and folders (zIndex 14 vs 15) — a
                stroke annotates the photos, and a note or a folder box is a
                thing you put on top of the board, not something to draw over
                and then lose. */}
            <InkOverlay strokes={ws.inkStrokes} pendingErase={pendingEraseSet} />
            {ws.inkDrawing && (
              <LiveStroke
                attachPath={ws.setInkPathEl}
                color={LABEL_COLORS[ws.inkColor]}
                width={ws.inkLiveWidth}
              />
            )}
            <StickyNoteOverlay
              notes={ws.stickyNotes}
              labelNames={ws.labelNames}
              onDragStart={ws.onStickyDown}
              onResizeStart={ws.onStickyResizeDown}
              onTextChange={ws.updateStickyText}
              onColorChange={ws.setStickyColor}
              onFontSizeChange={ws.setStickyFontSize}
              onToggleCheck={ws.toggleStickyCheck}
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
                : ws.isLabelsView
                  ? (cloud, name) => ws.renameLabel(cloud.key as AssetLabel, name)
                  : undefined
            }
            canRenameCloud={
              ws.isSenseView
                ? // Only a cloud backed by exactly ONE stored cluster: two
                  // clusters sharing a label draw as one cloud, and renaming
                  // "it" would silently rename half of it.
                  (cloud) => !!cloud.clusterId
                : ws.isLabelsView
                  ? // Every cloud but "No label", which is the absence of a
                    // colour and so has no name to set.
                    (cloud) => cloud.key !== NO_LABEL_CLOUD_KEY
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
        viewTabs={<ViewTabs show={ws.showViewTabs} view={ws.view} onSelect={ws.setView} />}
        afterProject={
          ws.projectMode ? (
            <WorkspaceToggle active={ws.view === "neural"} onSelect={() => ws.setView("neural")} />
          ) : undefined
        }
      />

      {/* Persistent by design: this is archive-integrity information, not a
          transient toast. Until #18 virtualizes the canvas, the newest 500 are
          the working set and this makes the remainder impossible to mistake
          for a failed upload. */}
      {hiddenPhotoCount > 0 && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 34,
            maxWidth: "calc(100vw - 32px)",
            padding: "6px 10px",
            background: "rgba(8,8,8,.88)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            boxShadow: "0 8px 24px rgba(0,0,0,.32)",
            color: "var(--t2)",
            fontSize: 10.5,
            lineHeight: 1.35,
            letterSpacing: "0.02em",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          Showing newest {initialPhotos.length} of {initialPhotoTotal} files on this canvas. The other{" "}
          {hiddenPhotoCount} remain in your archive.
        </div>
      )}

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
        isCanvasView={ws.view === "neural"}
        showAddToProject={ws.showAddToProject}
        selCount={ws.selectedIds.size}
        zoomPct={ws.zoomPct}
        searchOpen={ws.chatOpen}
        bulkPanelOpen={ws.bulkPanelOpen}
        onSelectTool={ws.toolSelect}
        onHandTool={ws.toolHand}
        onOpenSearch={ws.toggleChat}
        onToggleBulkPanel={ws.toggleBulkPanel}
        onExtractExif={ws.extractExif}
        onAdd={ws.addToolbar}
        onAddStickyNote={ws.addStickyNote}
        onInkTool={ws.toolInk}
        onEraserTool={ws.toolEraser}
        onToggleTrash={ws.toggleTrash}
        trashOpen={ws.trashOpen}
        onToggleLabels={ws.toggleLabelFilterPanel}
        labelsOpen={ws.labelFilterOpen}
        labelFilterActive={ws.labelFilter !== null}
        onFit={ws.onFit}
        onZoomReset={ws.onZoomReset}
        onAddToProject={ws.toggleAddProj}
      />

      <LabelFilterPanel
        open={ws.labelFilterOpen}
        names={ws.labelNames}
        counts={ws.labelCounts}
        active={ws.labelFilter}
        total={ws.projectPhotos.length}
        onSelect={ws.setLabelFilter}
        onRename={ws.renameLabel}
        onClose={ws.closeLabelFilterPanel}
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
          aiOpen={ws.bulkPanelOpen}
          onArtboard={ws.toolFrame}
          onTidy={ws.tidyUp}
          onAi={ws.toggleBulkPanel}
          onCopy={ws.copyFiles}
          onExport={ws.exportFiles}
          onGroup={ws.groupFiles}
          onFolder={ws.folderFiles}
          onDelete={ws.deleteSelected}
          labelNames={ws.labelNames}
          labelMenuOpen={ws.labelMenuOpen}
          selectionLabel={currentLabel}
          onToggleLabelMenu={ws.toggleLabelMenu}
          onPickLabel={(label) => ws.labelSelection(label)}
        />
      )}

      {/* The sorting views get their own, much narrower bar (ADR 0038): the
          Workspace one above acts on the `asset` bucket and a selection these
          views don't frame, so widening its gate would have Tidy up silently
          rearranging Canvas from inside Topic. Gated on isSenseView/
          isTimelineView, not on `view` — both also require a real project, and
          `view` can still read "sense" in all-files mode where no cloud exists. */}
      {(ws.isSenseView || ws.isTimelineView || ws.isLabelsView) && (
        <SortingActionBar
          showRecluster={ws.isSenseView}
          canRegroup={ws.canRegroup}
          busy={ws.proc.active}
          selCount={ws.selectedIds.size}
          onRegroup={ws.regroupClouds}
          onRecluster={ws.recluster}
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
        />
      )}

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
