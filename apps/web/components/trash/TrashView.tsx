"use client";

import { useState } from "react";
import {
  TRASH_RETENTION_DAYS,
  trashDaysLeft,
  type TrashItem,
  type TrashTarget,
} from "@archivemind/shared";
import ConfirmModal from "@/components/modals/ConfirmModal";
import { useTrash } from "@/hooks/useTrash";
import { trashItemKey, trashPurgeAllLabel } from "@/lib/trash-view";
import { formatBytes } from "@/lib/usage-format";
import TrashFilterBar from "./TrashFilterBar";
import TrashItemCard from "./TrashItemCard";
import TrashItemRow from "./TrashItemRow";
import TrashSelectionBar from "./TrashSelectionBar";

/** The Trash view's BODY (ADR 0049) — no page chrome of its own, the same shape
 *  as UsageView, because the signed-in app has exactly one shell (ADR 0037).
 *
 *  One list for every soft-deleted kind: projects, Workspaces, files of any
 *  asset_kind, and content drafts, which until now were deleted, kept forever
 *  and shown nowhere at all. */
export default function TrashView({
  onToast,
}: {
  onToast: (text: string, action?: { label: string; run: () => void }) => void;
}) {
  const trash = useTrash({ active: true, onToast });
  const [confirm, setConfirm] = useState<{ targets: TrashTarget[]; all: boolean } | null>(null);

  const askPurge = (targets: TrashTarget[], all = false) => setConfirm({ targets, all });

  const runPurge = () => {
    if (!confirm) return;
    trash.purge(confirm.targets);
    setConfirm(null);
  };

  /** "Empty trash" over a filtered list must delete what the filter MATCHES,
   *  not what happens to be on screen — a list showing 3 of 300 with a button
   *  that clears all 300 is the trap this view is here to close. So the ids are
   *  collected across pages before the confirmation names the number. */
  const purgeAll = async () => {
    const targets = await trash.collectTargets();
    if (targets.length > 0) askPurge(targets, true);
  };

  const oldest = trashDaysLeft(
    // oldestExpiresAt is the expiry; walk it back to the deletion so the one
    // shared helper still does the counting.
    trash.oldestExpiresAt
      ? new Date(new Date(trash.oldestExpiresAt).getTime() - TRASH_RETENTION_DAYS * 86_400_000).toISOString()
      : null,
  );

  const summary = [
    `${trash.total} ${trash.total === 1 ? "item" : "items"}`,
    trash.totalBytes > 0 ? formatBytes(trash.totalBytes) : null,
    oldest == null
      ? null
      : oldest === 0
        ? "oldest is due for removal"
        : `oldest leaves in ${oldest} ${oldest === 1 ? "day" : "days"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const isSelected = (item: TrashItem) => trash.selected.has(trashItemKey(item));

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 180, fontSize: 12, color: "var(--t2b)" }}>
          {trash.loading ? "Opening the Trash…" : summary}
        </div>
        {trash.total > 0 && (
          <button
            onClick={() => void purgeAll()}
            style={{
              height: 28,
              padding: "0 12px",
              background: "transparent",
              color: "var(--red)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: ".03em",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {trashPurgeAllLabel(trash.filtered, trash.total)}
          </button>
        )}
      </div>

      <TrashFilterBar
        counts={trash.counts}
        types={trash.types}
        onToggleType={trash.toggleType}
        query={trash.query}
        onQuery={trash.setQuery}
        sort={trash.sort}
        onSort={trash.setSort}
        expiringOnly={trash.expiringOnly}
        onExpiringOnly={trash.setExpiringOnly}
        expiringCount={trash.expiringSoon}
        mode={trash.mode}
        onMode={trash.setMode}
      />

      <TrashSelectionBar
        count={trash.selected.size}
        allSelected={trash.selected.size === trash.items.length && trash.items.length > 0}
        onSelectAll={trash.selectAll}
        onRestore={() => trash.restore(trash.selectedTargets)}
        onPurge={() => askPurge(trash.selectedTargets)}
        onClear={trash.clearSelection}
      />

      {trash.items.length > 0 &&
        (trash.mode === "grid" ? (
          <div
            className="am-home-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 12,
            }}
          >
            {trash.items.map((item) => (
              <TrashItemCard
                key={trashItemKey(item)}
                item={item}
                selected={isSelected(item)}
                onToggle={() => trash.toggleSelect(item)}
                onRestore={() => trash.restore([{ kind: item.kind, id: item.id }])}
                onPurge={() => askPurge([{ kind: item.kind, id: item.id }])}
              />
            ))}
          </div>
        ) : (
          <div style={{ border: "1px solid var(--bd)", borderRadius: 3, overflow: "hidden" }}>
            {trash.items.map((item) => (
              <TrashItemRow
                key={trashItemKey(item)}
                item={item}
                selected={isSelected(item)}
                onToggle={() => trash.toggleSelect(item)}
                onRestore={() => trash.restore([{ kind: item.kind, id: item.id }])}
                onPurge={() => askPurge([{ kind: item.kind, id: item.id }])}
              />
            ))}
          </div>
        ))}

      {trash.hasMore && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <button
            onClick={trash.loadMore}
            disabled={trash.loadingMore}
            style={{
              height: 30,
              padding: "0 16px",
              background: "var(--bg-s)",
              color: "var(--t2)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              fontSize: 11.5,
              cursor: trash.loadingMore ? "default" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {trash.loadingMore
              ? "Loading…"
              : `Show more (${trash.total - trash.items.length} left)`}
          </button>
        </div>
      )}

      {!trash.loading && trash.items.length === 0 && (
        <div style={{ marginTop: 26, fontSize: 12.5, color: "var(--tm)" }}>
          {trash.filtered ? (
            <>
              Nothing in the Trash matches these filters.{" "}
              <button
                onClick={trash.clearFilters}
                style={{
                  background: "transparent",
                  border: 0,
                  padding: 0,
                  color: "var(--ac)",
                  fontSize: 12.5,
                  fontFamily: "inherit",
                  cursor: "pointer",
                }}
              >
                Clear filters
              </button>
            </>
          ) : (
            `Trash is empty — deleted projects, files, workspaces and drafts stay here for ${TRASH_RETENTION_DAYS} days before they're removed for good.`
          )}
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        title={confirm?.all ? "Delete everything shown?" : "Delete permanently?"}
        body={
          confirm
            ? confirm.all
              ? `All ${confirm.targets.length} items listed here will be permanently deleted, including previews and AI data. This cannot be undone.`
              : confirm.targets.length === 1
                ? "This item will be permanently deleted, including its previews and AI data. This cannot be undone."
                : `${confirm.targets.length} items will be permanently deleted, including their previews and AI data. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete permanently"
        danger
        onConfirm={runPurge}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
