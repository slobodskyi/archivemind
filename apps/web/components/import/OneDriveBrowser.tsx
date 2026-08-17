"use client";

import { useState } from "react";
import type { OneDriveImportItem } from "@archivemind/shared";
import { useOneDriveBrowse } from "@/hooks/useOneDriveBrowse";
import type { BrowseEntry } from "@/lib/onedrive";

/** The OneDrive file/folder browser (ADR 0047 D1) — our own list over Graph
 *  instead of Microsoft's v8 picker.
 *
 *  The selling point over Drive is right here: a FOLDER is selectable, and the
 *  worker expands it. `drive.file` cannot do that, which is why Drive import
 *  makes people multi-select thousands of files by hand. */

interface Props {
  /** Selected items → POST /api/imports. Folders ride along as isFolder:true. */
  onImport: (items: OneDriveImportItem[]) => void | Promise<void>;
  busy: boolean;
}

const entryKey = (e: { driveId: string; itemId: string }) => `${e.driveId}:${e.itemId}`;

function formatBytes(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export default function OneDriveBrowser({ onImport, busy }: Props) {
  const { crumbs, entries, loading, error, nextSkipToken, openFolder, goTo, loadMore } =
    useOneDriveBrowse();
  const [selected, setSelected] = useState<Map<string, BrowseEntry>>(new Map());

  function toggle(e: BrowseEntry) {
    setSelected((prev) => {
      const next = new Map(prev);
      const key = entryKey(e);
      if (next.has(key)) next.delete(key);
      else next.set(key, e);
      return next;
    });
  }

  const chosen = [...selected.values()];
  const chosenFolders = chosen.filter((e) => e.isFolder);
  const chosenFiles = chosen.filter((e) => !e.isFolder);
  // childCount is DIRECT children only — Graph exposes no recursive count, and
  // pre-walking to get one is the expensive operation this estimate exists to
  // avoid. Labelled "about" for exactly that reason (ADR 0047 D6).
  const estimate =
    chosenFiles.length + chosenFolders.reduce((sum, f) => sum + (f.childCount ?? 0), 0);

  function submit() {
    if (busy || chosen.length === 0) return;
    void onImport(
      chosen.map((e) => ({
        driveId: e.driveId,
        itemId: e.itemId,
        name: e.name,
        isFolder: e.isFolder,
        ...(e.sizeBytes != null ? { sizeBytes: e.sizeBytes } : {}),
        ...(e.mimeType ? { mimeType: e.mimeType } : {}),
        ...(e.path ? { path: e.path } : {}),
      })),
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", fontSize: 11.5 }}>
        {crumbs.map((c, i) => (
          <span key={`${c.itemId}-${i}`} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {i > 0 && <span style={{ color: "var(--t3)" }}>/</span>}
            <button
              onClick={() => goTo(i)}
              disabled={i === crumbs.length - 1}
              style={{
                border: 0,
                background: "transparent",
                padding: 0,
                fontFamily: "inherit",
                fontSize: 11.5,
                color: i === crumbs.length - 1 ? "var(--t1)" : "var(--t2b)",
                fontWeight: i === crumbs.length - 1 ? 700 : 400,
                cursor: i === crumbs.length - 1 ? "default" : "pointer",
              }}
            >
              {c.name}
            </button>
          </span>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 180,
          maxHeight: 260,
          overflowY: "auto",
          border: "1px solid var(--bd)",
          borderRadius: 2,
          background: "var(--bg-el)",
        }}
      >
        {loading && entries.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: "var(--t3)" }}>Loading…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 14, fontSize: 12, color: "var(--t3)" }}>This folder is empty.</div>
        ) : (
          entries.map((e) => {
            const key = entryKey(e);
            const isSelected = selected.has(key);
            return (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "7px 10px",
                  borderBottom: "1px solid var(--bd)",
                  background: isSelected ? "var(--bg-sf)" : "transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(e)}
                  aria-label={`Select ${e.name}`}
                  style={{ flex: "0 0 auto", cursor: "pointer" }}
                />
                <button
                  onClick={() => (e.isFolder ? openFolder(e) : toggle(e))}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: 0,
                    background: "transparent",
                    padding: 0,
                    textAlign: "left",
                    fontFamily: "inherit",
                    cursor: "pointer",
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      width: 32,
                      height: 32,
                      flex: "0 0 auto",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--bg)",
                      borderRadius: 2,
                      overflow: "hidden",
                      fontSize: 12,
                      color: "var(--t3)",
                    }}
                  >
                    {e.thumbnailUrl ? (
                      // Plain <img>, not next/image: these are short-lived
                      // pre-authenticated Microsoft CDN URLs, so there is
                      // nothing to optimise and no host to whitelist.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={e.thumbnailUrl}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                        style={{ width: 32, height: 32, objectFit: "cover", display: "block" }}
                      />
                    ) : (
                      // Folders, and anything Graph has no thumbnail for.
                      (e.isFolder ? "▸" : "·")
                    )}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      color: "var(--t1)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.name}
                  </span>
                  <span style={{ flex: "0 0 auto", fontSize: 11, color: "var(--t3)" }}>
                    {e.isFolder
                      ? e.childCount != null
                        ? `${e.childCount} item${e.childCount === 1 ? "" : "s"}`
                        : "folder"
                      : formatBytes(e.sizeBytes)}
                  </span>
                </button>
              </div>
            );
          })
        )}
        {nextSkipToken && (
          <button
            onClick={loadMore}
            disabled={loading}
            style={{
              width: "100%",
              padding: "8px 10px",
              border: 0,
              background: "transparent",
              color: "var(--t2b)",
              fontFamily: "inherit",
              fontSize: 11.5,
              cursor: loading ? "default" : "pointer",
            }}
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      {error && <div style={{ fontSize: 11.5, color: "var(--err, #ff6b6b)" }}>{error}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--t3)" }}>
          {chosen.length === 0
            ? "Select files, or a folder to import everything inside it."
            : `${chosenFolders.length > 0 ? `${chosenFolders.length} folder${chosenFolders.length === 1 ? "" : "s"}` : ""}${
                chosenFolders.length > 0 && chosenFiles.length > 0 ? " + " : ""
              }${chosenFiles.length > 0 ? `${chosenFiles.length} file${chosenFiles.length === 1 ? "" : "s"}` : ""}${
                chosenFolders.length > 0 ? ` — about ${estimate} items, subfolders included` : ""
              }`}
        </div>
        <button
          onClick={submit}
          disabled={busy || chosen.length === 0}
          style={{
            flex: "0 0 auto",
            padding: "8px 16px",
            background: "var(--ac)",
            color: "#050505",
            border: 0,
            borderRadius: 2,
            fontSize: 12,
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: busy || chosen.length === 0 ? "default" : "pointer",
            opacity: busy || chosen.length === 0 ? 0.5 : 1,
          }}
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
    </div>
  );
}
