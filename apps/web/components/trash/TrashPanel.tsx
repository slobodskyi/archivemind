"use client";

import { useState } from "react";
import type { Board, TrashFilterKey, TrashTarget } from "@archivemind/shared";
import ConfirmModal from "@/components/modals/ConfirmModal";
import { CloseIcon } from "@/components/icons/icons";
import { useTrash } from "@/hooks/useTrash";
import { LABEL_COLORS } from "@/lib/labels";
import { trashExpiry, trashItemKey } from "@/lib/trash-view";
import TrashItemRow from "./TrashItemRow";

interface TrashPanelProps {
  open: boolean;
  /** Scopes the drafts to this project; assets stay workspace-global, which is
   *  what this panel has always shown and what its copy says. */
  projectId: string;
  /** Trashed Workspaces of the project being viewed (ADR 0044 as amended). They
   *  arrive with the canvas and are owned by the header's board state, so they
   *  are NOT read through /api/trash here — restoring one has to put its chip
   *  back in the breadcrumb on the same frame. */
  boards: Board[];
  onClose: () => void;
  onRestoreBoard: (id: string) => void;
  onPurgeBoard: (id: string) => void;
  onToast: (text: string, action?: { label: string; run: () => void }) => void;
  /** Bring restored rows back onto the canvas. */
  onRestored: () => void;
}

/** Everything the panel may list on its own. Workspaces are excluded on
 *  purpose — see `boards` above. */
const PANEL_TYPES: readonly TrashFilterKey[] = ["photo", "pdf", "document", "other", "draft"];

const sectionLabel: React.CSSProperties = {
  padding: "8px 8px 4px",
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--t3)",
};

const textBtn = (color: string): React.CSSProperties => ({
  border: 0,
  background: "transparent",
  color,
  cursor: "pointer",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: "0.04em",
  fontFamily: "inherit",
  padding: "3px 6px",
  borderRadius: 2,
});

/** In-workspace Trash (ADR 0033, unified by ADR 0049): the same rows the
 *  homepage Trash view renders, as a right-side panel, so a mistaken delete can
 *  be undone without leaving the canvas. It is a narrower SLICE of one model
 *  rather than a second implementation — the countdown, the type label and the
 *  "restores to" line are computed in exactly one place for both surfaces.
 *
 *  Trashed Workspaces sit above the files. They are the panel's one
 *  project-scoped section — a workspace is a subset of ONE project, whereas a
 *  trashed photo is workspace-global — which is also why they do not appear in
 *  the homepage view. Restoring one brings back its files, notes and folders
 *  exactly as they were: the delete only ever stamped the row. */
export default function TrashPanel({
  open,
  projectId,
  boards,
  onClose,
  onRestoreBoard,
  onPurgeBoard,
  onToast,
  onRestored,
}: TrashPanelProps) {
  const trash = useTrash({
    active: open,
    projectId: projectId === "all" ? null : projectId,
    allow: PANEL_TYPES,
    onToast,
    onRestored,
  });
  const [confirm, setConfirm] = useState<TrashTarget[] | null>(null);

  if (!open) return null;

  const count = trash.total;

  return (
    <div
      // The chat panel and the photo drawer already clamp themselves to the
      // viewport; this one held a hard 360 and overflowed a narrower phone.
      className="am-trash-panel"
      style={{
        position: "absolute",
        top: "var(--hdr)",
        right: 0,
        bottom: 0,
        width: 360,
        background: "rgba(12,12,12,.97)",
        borderLeft: "1px solid var(--bd)",
        backdropFilter: "blur(16px)",
        boxShadow: "-8px 0 32px rgba(0,0,0,.45)",
        zIndex: 37,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid var(--bd)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t1)" }}>
            Trash
          </span>
          {!trash.loading && (
            <span style={{ fontSize: 10.5, color: "var(--t3)" }}>
              {count} {count === 1 ? "file" : "files"}
              {boards.length > 0 &&
                ` · ${boards.length} ${boards.length === 1 ? "workspace" : "workspaces"}`}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close trash"
          style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--t2)", cursor: "pointer" }}
        >
          <CloseIcon width={12} height={12} />
        </button>
      </div>

      <div style={{ padding: "8px 10px 6px", borderBottom: "1px solid var(--bd)" }}>
        <input
          value={trash.query}
          onChange={(e) => trash.setQuery(e.target.value)}
          placeholder="Search trash…"
          aria-label="Search trash"
          style={{
            width: "100%",
            height: 26,
            padding: "0 8px",
            background: "var(--bg-in)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            color: "var(--t1)",
            fontSize: 11.5,
            fontFamily: "inherit",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
        <div style={{ marginTop: 6, fontSize: 10.5, lineHeight: 1.5, color: "var(--t3)" }}>
          {boards.length > 0
            ? "Deleted workspaces and files stay here for 30 days, then they’re removed for good. Restoring a workspace brings back its files, notes and folders."
            : "Deleted files stay here for 30 days, then they’re removed for good."}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px 14px" }}>
        {/* Workspaces first: they are the coarser thing, and one of them coming
            back can bring hundreds of tiles with it. */}
        {boards.length > 0 && (
          <>
            <div style={sectionLabel}>Workspaces</div>
            {boards.map((board) => {
              const expiry = trashExpiry(board.deletedAt);
              return (
                <div key={board.id} className="am-mi" style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", borderRadius: 3 }}>
                  <span
                    aria-hidden="true"
                    style={{ flex: "0 0 auto", width: 14, height: 14, borderRadius: "50%", background: LABEL_COLORS[board.color] }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {board.name}
                    </div>
                    <div style={{ fontSize: 10, color: expiry.urgent ? "var(--red)" : "var(--t2b)", marginTop: 2 }}>
                      {board.assetIds.length} {board.assetIds.length === 1 ? "file" : "files"}
                      {" · "}
                      {expiry.label}
                    </div>
                  </div>
                  <div style={{ flex: "0 0 auto", display: "flex", gap: 2 }}>
                    <button style={textBtn("var(--ac)")} onClick={() => onRestoreBoard(board.id)}>
                      Restore
                    </button>
                    <button style={textBtn("var(--red)")} onClick={() => onPurgeBoard(board.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
            <div style={sectionLabel}>Files</div>
          </>
        )}

        {trash.loading ? (
          <div style={{ padding: "24px 12px", fontSize: 11, color: "var(--t3)" }}>Loading…</div>
        ) : trash.items.length === 0 ? (
          <div style={{ padding: "24px 12px", fontSize: 11, color: "var(--t3)", lineHeight: 1.5 }}>
            {trash.filtered
              ? "Nothing in the Trash matches that."
              : boards.length > 0
                ? "No deleted files."
                : "Trash is empty. Deleted files will appear here."}
          </div>
        ) : (
          <>
            {trash.items.map((item) => (
              <TrashItemRow
                key={trashItemKey(item)}
                item={item}
                selected={false}
                compact
                onRestore={() => trash.restore([{ kind: item.kind, id: item.id }])}
                onPurge={() => setConfirm([{ kind: item.kind, id: item.id }])}
              />
            ))}
            {trash.hasMore && (
              <button
                onClick={trash.loadMore}
                disabled={trash.loadingMore}
                style={{ ...textBtn("var(--t2)"), width: "100%", padding: "8px 6px" }}
              >
                {trash.loadingMore ? "Loading…" : `Show more (${trash.total - trash.items.length} left)`}
              </button>
            )}
          </>
        )}
      </div>

      {trash.items.length > 0 && (
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--bd)" }}>
          <button
            style={{ ...textBtn("var(--ac)"), padding: "6px 10px", border: "1px solid var(--bd)" }}
            onClick={() =>
              void trash.collectTargets().then((targets) => trash.restore(targets))
            }
          >
            Restore all
          </button>
          <button
            style={{ ...textBtn("var(--red)"), padding: "6px 10px", border: "1px solid var(--bd)" }}
            // Acts on everything the current search matches, not on the rows
            // that happen to be loaded — the number in the confirmation is the
            // number that disappears (ADR 0049).
            onClick={() =>
              void trash.collectTargets().then((targets) => targets.length > 0 && setConfirm(targets))
            }
          >
            {trash.filtered ? "Delete shown" : "Empty trash"}
          </button>
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        title="Delete permanently?"
        body={
          confirm
            ? confirm.length === 1
              ? "This item will be permanently deleted, including its previews and AI data. This cannot be undone."
              : `${confirm.length} items will be permanently deleted, including their previews and AI data. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete permanently"
        danger
        onConfirm={() => {
          if (confirm) trash.purge(confirm);
          setConfirm(null);
        }}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
