"use client";

import { memo, useMemo } from "react";
import type { Photo, PhotoSource } from "@/types";
import { photoSrc } from "@/lib/img";
import type { ProjectListItem, SidebarViewMode } from "@/hooks/useWorkspace";
import { SOURCES } from "@/lib/mock-data";
import { groupBySourceFolder } from "@/lib/layout";
import { CloseIcon, CheckIcon, AddIcon, SparkleIcon } from "@/components/icons/icons";
import AddToProjectPopover from "@/components/toolbar/AddToProjectPopover";

interface SourceBrowserSidebarProps {
  open: boolean;
  tabs: PhotoSource[];
  activeTab: PhotoSource | null;
  photos: Photo[];
  selectedIds: Set<string>;
  searchText: string;
  addOpen: boolean;
  projectList: ProjectListItem[];
  viewMode: SidebarViewMode;
  /** Shifts the sidebar left so it sits beside (not under) an open chat panel — same convention as PhotoDrawer. */
  right?: number;
  onSelectTab: (source: PhotoSource) => void;
  onCloseTab: (source: PhotoSource) => void;
  onClose: () => void;
  onToggleFile: (id: string) => void;
  /** Double-click a row → open the photo drawer (Finder-style inspect). */
  onOpenFile: (id: string) => void;
  /** Run AI analyze on the sidebar selection (user-triggered — issue #12). */
  onAnalyze: () => void;
  onToggleGroup: (ids: string[]) => void;
  onSearchChange: (text: string) => void;
  onToggleAddOpen: () => void;
  onCloseAddOpen: () => void;
  onSelectProject: (key: string) => void;
  onCreateProject: () => void;
  onSetViewMode: (mode: SidebarViewMode) => void;
}

/** Mock keyword filter — matches every whitespace-separated word in the query
 * against filename/group/country/source/tags. No LLM call, deterministic. */
function matchesQuery(p: Photo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [p.filename, p.group, p.country, p.source, p.folder, ...(p.tags ?? [])].join(" ").toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

function Checkbox({ checked, size = 15 }: { checked: boolean; size?: number }) {
  return (
    <span
      style={{
        display: "flex",
        width: size,
        height: size,
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 2,
        border: checked ? "none" : "1px solid var(--bdh)",
        background: checked ? "var(--ac)" : "transparent",
      }}
    >
      {checked && <CheckIcon width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} stroke="#050505" strokeWidth={3} />}
    </span>
  );
}

const VIEW_MODES: { key: SidebarViewMode; label: string }[] = [
  { key: "pile", label: "Pile" },
  { key: "list", label: "List" },
  { key: "gallery", label: "Gallery" },
];

function PileIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x={5} y={5} width={14} height={10} rx={1} />
      <path d="M3 9h2M3 13h2" opacity={0.5} />
      <path d="M7 3h10M7 19h10" opacity={0.5} />
    </svg>
  );
}
function ListIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
function GalleryIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x={4} y={4} width={7} height={7} rx={1} />
      <rect x={13} y={4} width={7} height={7} rx={1} />
      <rect x={4} y={13} width={7} height={7} rx={1} />
      <rect x={13} y={13} width={7} height={7} rx={1} />
    </svg>
  );
}

function ViewModeSwitcher({ mode, onSet }: { mode: SidebarViewMode; onSet: (m: SidebarViewMode) => void }) {
  const icons: Record<SidebarViewMode, React.ReactNode> = {
    pile: <PileIcon />,
    list: <ListIcon />,
    gallery: <GalleryIcon />,
  };
  return (
    <div style={{ display: "flex", gap: 1, background: "var(--bg-el)", border: "1px solid var(--bd)", borderRadius: 2, padding: 2 }}>
      {VIEW_MODES.map((m) => {
        const active = mode === m.key;
        return (
          <button
            key={m.key}
            onClick={() => onSet(m.key)}
            title={m.label}
            aria-label={`${m.label} view`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 26,
              height: 22,
              border: 0,
              borderRadius: 2,
              cursor: "pointer",
              background: active ? "var(--bg-sf)" : "transparent",
              color: active ? "var(--t1)" : "var(--t3)",
            }}
          >
            {icons[m.key]}
          </button>
        );
      })}
    </div>
  );
}

interface Group {
  key: string;
  label: string;
  photos: Photo[];
}

function ListBody({
  groups,
  selectedIds,
  onToggleFile,
  onOpenFile,
  onToggleGroup,
}: {
  groups: Group[];
  selectedIds: Set<string>;
  onToggleFile: (id: string) => void;
  onOpenFile: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
}) {
  return (
    <>
      {groups.map((g) => {
        const ids = g.photos.map((p) => p.id);
        const allSelected = ids.every((id) => selectedIds.has(id));
        return (
          <div key={g.key} style={{ marginBottom: 6 }}>
            <div
              onClick={() => onToggleGroup(ids)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer" }}
            >
              <Checkbox checked={allSelected} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                {g.label}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>{g.photos.length}</span>
            </div>
            {g.photos.map((p) => (
              <div
                key={p.id}
                onClick={() => onToggleFile(p.id)}
                onDoubleClick={() => onOpenFile(p.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "6px 10px 6px 30px",
                  cursor: "pointer",
                  borderRadius: 2,
                  background: selectedIds.has(p.id) ? "color-mix(in srgb,var(--ac) 10%,transparent)" : "transparent",
                }}
              >
                <Checkbox checked={selectedIds.has(p.id)} />
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 2,
                    flex: "0 0 auto",
                    backgroundImage: `url(${photoSrc(p, 60, 60)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <span style={{ fontSize: 12.5, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.filename}
                </span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function GalleryBody({
  groups,
  selectedIds,
  onToggleFile,
  onOpenFile,
  onToggleGroup,
}: {
  groups: Group[];
  selectedIds: Set<string>;
  onToggleFile: (id: string) => void;
  onOpenFile: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
}) {
  return (
    <>
      {groups.map((g) => {
        const ids = g.photos.map((p) => p.id);
        const allSelected = ids.every((id) => selectedIds.has(id));
        return (
          <div key={g.key} style={{ marginBottom: 10 }}>
            <div
              onClick={() => onToggleGroup(ids)}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", cursor: "pointer" }}
            >
              <Checkbox checked={allSelected} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                {g.label}
              </span>
              <span style={{ fontSize: 10.5, color: "var(--tm)" }}>{g.photos.length}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, padding: "0 10px" }}>
              {g.photos.map((p) => {
                const sel = selectedIds.has(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => onToggleFile(p.id)}
                    onDoubleClick={() => onOpenFile(p.id)}
                    style={{
                      position: "relative",
                      cursor: "pointer",
                      borderRadius: 2,
                      overflow: "hidden",
                      border: sel ? "2px solid var(--ac)" : "1px solid var(--bd)",
                    }}
                  >
                    <div
                      style={{
                        width: "100%",
                        paddingTop: "100%",
                        backgroundImage: `url(${photoSrc(p, 240, 240)})`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                    <div style={{ position: "absolute", top: 4, left: 4 }}>
                      <Checkbox checked={sel} size={14} />
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: "3px 5px",
                        background: "linear-gradient(transparent, rgba(0,0,0,.75))",
                        color: "#fff",
                        fontSize: 10,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.filename}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

function PileBody({
  groups,
  selectedIds,
  onToggleGroup,
}: {
  groups: Group[];
  selectedIds: Set<string>;
  onToggleGroup: (ids: string[]) => void;
}) {
  return (
    <div style={{ padding: "4px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
      {groups.map((g) => {
        const ids = g.photos.map((p) => p.id);
        const allSelected = ids.every((id) => selectedIds.has(id));
        const someSelected = !allSelected && ids.some((id) => selectedIds.has(id));
        const top = g.photos.slice(0, 3);
        return (
          <div
            key={g.key}
            onClick={() => onToggleGroup(ids)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 10px",
              borderRadius: 2,
              cursor: "pointer",
              background: allSelected
                ? "color-mix(in srgb,var(--ac) 12%,transparent)"
                : someSelected
                  ? "color-mix(in srgb,var(--ac) 5%,transparent)"
                  : "var(--bg-el)",
              border: allSelected ? "1px solid var(--ac)" : "1px solid var(--bd)",
            }}
          >
            <div style={{ position: "relative", width: 68, height: 56, flex: "0 0 auto" }}>
              {top.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    position: "absolute",
                    left: i * 8,
                    top: i * 6,
                    width: 48,
                    height: 48,
                    borderRadius: 3,
                    border: "1.5px solid var(--bg-sf)",
                    backgroundImage: `url(${photoSrc(p, 120, 120)})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    boxShadow: "0 2px 6px rgba(0,0,0,.4)",
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {g.label}
              </span>
              <span style={{ fontSize: 11, color: "var(--tm)" }}>
                {g.photos.length} {g.photos.length === 1 ? "file" : "files"}
              </span>
            </div>
            <Checkbox checked={allSelected} />
          </div>
        );
      })}
    </div>
  );
}

function SourceBrowserSidebar({
  open,
  tabs,
  activeTab,
  photos,
  selectedIds,
  searchText,
  addOpen,
  projectList,
  viewMode,
  right = 0,
  onSelectTab,
  onCloseTab,
  onClose,
  onToggleFile,
  onOpenFile,
  onAnalyze,
  onToggleGroup,
  onSearchChange,
  onToggleAddOpen,
  onCloseAddOpen,
  onSelectProject,
  onCreateProject,
  onSetViewMode,
}: SourceBrowserSidebarProps) {
  const groups = useMemo(() => {
    if (!activeTab) return [];
    return groupBySourceFolder(photos, activeTab)
      .map((g) => ({ ...g, photos: g.photos.filter((p) => matchesQuery(p, searchText)) }))
      .filter((g) => g.photos.length > 0);
  }, [photos, activeTab, searchText]);

  // Closed offset must clear the sidebar's own width *plus* however far
  // `right` has already shifted it left (e.g. for an open chat panel) —
  // otherwise the "hidden" sidebar lands back on-screen and overlays
  // whatever is to its right (see PhotoDrawer's identical fix).
  const sheet = open ? "translateX(0)" : `translateX(${380 + right + 20}px)`;

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
        right,
        bottom: 0,
        width: 380,
        background: "var(--bg-sf)",
        borderLeft: "1px solid var(--bd)",
        boxShadow: "-16px 0 48px rgba(0,0,0,.5)",
        zIndex: 45,
        transform: sheet,
        transition: "transform .25s cubic-bezier(.22,1,.36,1), right .22s cubic-bezier(.22,1,.36,1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 13px 11px", borderBottom: "1px solid var(--bd)" }}>
        <span style={{ fontSize: 13, fontWeight: 400, color: "var(--t1)" }}>Browse sources</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <ViewModeSwitcher mode={viewMode} onSet={onSetViewMode} />
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t2b)", cursor: "pointer" }}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 4, padding: "8px 10px", borderBottom: "1px solid var(--bd)", overflowX: "auto" }}>
        {tabs.map((t) => {
          const meta = SOURCES[t];
          const active = t === activeTab;
          return (
            <div
              key={t}
              onClick={() => onSelectTab(t)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 8px",
                borderRadius: 2,
                cursor: "pointer",
                background: active ? "var(--bg-el)" : "transparent",
                border: active ? `1px solid ${meta.color}` : "1px solid transparent",
                flex: "0 0 auto",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 999, flex: "0 0 auto", background: meta.color }} />
              <span style={{ fontSize: 11.5, color: active ? "var(--t1)" : "var(--t2)", whiteSpace: "nowrap" }}>{meta.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(t);
                }}
                aria-label={`Close ${meta.label} tab`}
                style={{ display: "flex", width: 15, height: 15, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--t2b)", cursor: "pointer", padding: 0 }}
              >
                <CloseIcon width={9} height={9} strokeWidth={2} />
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 4px" }}>
        {groups.length === 0 && (
          <div style={{ padding: "24px 16px", fontSize: 12.5, color: "var(--tm)", textAlign: "center" }}>
            No files match{searchText ? ` "${searchText}"` : ""}.
          </div>
        )}
        {groups.length > 0 && viewMode === "list" && (
          <ListBody groups={groups} selectedIds={selectedIds} onToggleFile={onToggleFile} onOpenFile={onOpenFile} onToggleGroup={onToggleGroup} />
        )}
        {groups.length > 0 && viewMode === "gallery" && (
          <GalleryBody groups={groups} selectedIds={selectedIds} onToggleFile={onToggleFile} onOpenFile={onOpenFile} onToggleGroup={onToggleGroup} />
        )}
        {groups.length > 0 && viewMode === "pile" && (
          <PileBody groups={groups} selectedIds={selectedIds} onToggleGroup={onToggleGroup} />
        )}
      </div>

      <div style={{ position: "relative", borderTop: "1px solid var(--bd)", padding: 11, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 2, padding: "8px 10px" }}>
          <SparkleIcon width={13} height={13} stroke="var(--ac)" strokeWidth={1.7} />
          <input
            value={searchText}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder='Find files — "trees", "night", "medics"…'
            style={{ flex: 1, background: "transparent", border: 0, outline: 0, color: "var(--t1)", fontSize: 12.5, fontFamily: "inherit" }}
          />
          {searchText && (
            <button
              onClick={() => onSearchChange("")}
              aria-label="Clear search"
              style={{ display: "flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--t2b)", cursor: "pointer" }}
            >
              <CloseIcon width={10} height={10} />
            </button>
          )}
        </div>

        <button
          onClick={onAnalyze}
          disabled={selectedIds.size === 0}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            height: 36,
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            cursor: selectedIds.size ? "pointer" : "default",
            background: "var(--bg-el)",
            color: selectedIds.size ? "var(--ac)" : "var(--tm)",
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: "inherit",
          }}
        >
          <SparkleIcon width={13} height={13} stroke="currentColor" strokeWidth={1.7} />
          Analyze {selectedIds.size || ""} with AI
        </button>

        <button
          onClick={onToggleAddOpen}
          disabled={selectedIds.size === 0}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            height: 36,
            border: 0,
            borderRadius: 2,
            cursor: selectedIds.size ? "pointer" : "default",
            background: selectedIds.size ? "var(--ac)" : "var(--bg-el)",
            color: selectedIds.size ? "#050505" : "var(--tm)",
            fontSize: 12.5,
            fontWeight: 700,
            fontFamily: "inherit",
          }}
        >
          <AddIcon width={14} height={14} />
          Add {selectedIds.size || ""} to project
        </button>

        <AddToProjectPopover
          open={addOpen}
          list={projectList}
          onClose={onCloseAddOpen}
          onSelect={onSelectProject}
          onCreateNew={onCreateProject}
          positionStyle={{ left: 11, right: 11, bottom: 56, width: "auto" }}
        />
      </div>
    </div>
  );
}

export default memo(SourceBrowserSidebar);
