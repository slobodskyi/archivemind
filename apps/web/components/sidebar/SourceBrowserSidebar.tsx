"use client";

import { useMemo } from "react";
import type { Photo, PhotoSource } from "@/types";
import { photoSrc } from "@/lib/img";
import type { ProjectListItem } from "@/hooks/useWorkspace";
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
  /** Shifts the sidebar left so it sits beside (not under) an open chat panel — same convention as PhotoDrawer. */
  right?: number;
  onSelectTab: (source: PhotoSource) => void;
  onCloseTab: (source: PhotoSource) => void;
  onClose: () => void;
  onToggleFile: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onSearchChange: (text: string) => void;
  onToggleAddOpen: () => void;
  onCloseAddOpen: () => void;
  onSelectProject: (key: string) => void;
  onCreateProject: () => void;
}

/** Mock keyword filter — matches every whitespace-separated word in the query
 * against filename/group/country/source/tags. No LLM call, deterministic. */
function matchesQuery(p: Photo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [p.filename, p.group, p.country, p.source, p.folder, ...(p.tags ?? [])].join(" ").toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      style={{
        display: "flex",
        width: 15,
        height: 15,
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 2,
        border: checked ? "none" : "1px solid var(--bdh)",
        background: checked ? "var(--ac)" : "transparent",
      }}
    >
      {checked && <CheckIcon width={9} height={9} stroke="#050505" strokeWidth={3} />}
    </span>
  );
}

export default function SourceBrowserSidebar({
  open,
  tabs,
  activeTab,
  photos,
  selectedIds,
  searchText,
  addOpen,
  projectList,
  right = 0,
  onSelectTab,
  onCloseTab,
  onClose,
  onToggleFile,
  onToggleGroup,
  onSearchChange,
  onToggleAddOpen,
  onCloseAddOpen,
  onSelectProject,
  onCreateProject,
}: SourceBrowserSidebarProps) {
  const groups = useMemo(() => {
    if (!activeTab) return [];
    return groupBySourceFolder(photos, activeTab)
      .map((g) => ({ ...g, photos: g.photos.filter((p) => matchesQuery(p, searchText)) }))
      .filter((g) => g.photos.length > 0);
  }, [photos, activeTab, searchText]);

  const sheet = open ? "translateX(0)" : "translateX(400px)";

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
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--t1)" }}>Browse sources</span>
        <button
          onClick={onClose}
          aria-label="Close sidebar"
          style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t3)", cursor: "pointer" }}
        >
          <CloseIcon />
        </button>
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
                style={{ display: "flex", width: 15, height: 15, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--t3)", cursor: "pointer", padding: 0 }}
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
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--t2)", textTransform: "uppercase", letterSpacing: ".05em" }}>
                  {g.label}
                </span>
                <span style={{ fontSize: 10.5, color: "var(--tm)" }}>{g.photos.length}</span>
              </div>
              {g.photos.map((p) => (
                <div
                  key={p.id}
                  onClick={() => onToggleFile(p.id)}
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
              style={{ display: "flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--t3)", cursor: "pointer" }}
            >
              <CloseIcon width={10} height={10} />
            </button>
          )}
        </div>

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
            fontWeight: 600,
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
