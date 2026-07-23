import type { TrashedAsset } from "@archivemind/shared";
import { CloseIcon } from "@/components/icons/icons";

interface TrashPanelProps {
  open: boolean;
  /** null = still loading the list. */
  assets: TrashedAsset[] | null;
  onClose: () => void;
  onRestore: (ids: string[]) => void;
  onPurge: (ids: string[]) => void;
}

/** Whole days until the 30-day retention sweep claims a trashed asset (ADR 0033);
 *  null when there is no timestamp. */
function daysLeft(deletedAt: string | null): number | null {
  if (!deletedAt) return null;
  const remaining = new Date(deletedAt).getTime() + 30 * 86_400_000 - Date.now();
  return Math.max(0, Math.ceil(remaining / 86_400_000));
}

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

/** In-workspace Trash (ADR 0033): the same trashed-asset list as the homepage
 *  Trash view, as a right-side panel so a mistaken delete can be undone without
 *  leaving the canvas. Restore puts the asset back on the canvas; permanent
 *  delete purges it (confirmed first). */
export default function TrashPanel({ open, assets, onClose, onRestore, onPurge }: TrashPanelProps) {
  if (!open) return null;
  const count = assets?.length ?? 0;

  return (
    <div
      style={{
        position: "absolute",
        top: 52,
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
          {assets && (
            <span style={{ fontSize: 10.5, color: "var(--t3)" }}>
              {count} {count === 1 ? "photo" : "photos"}
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
        <div style={{ fontSize: 10.5, lineHeight: 1.5, color: "var(--t3)" }}>
          Deleted photos stay here for 30 days, then they’re removed for good.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "6px 6px 14px" }}>
        {assets === null ? (
          <div style={{ padding: "24px 12px", fontSize: 11, color: "var(--t3)" }}>Loading…</div>
        ) : count === 0 ? (
          <div style={{ padding: "24px 12px", fontSize: 11, color: "var(--t3)", lineHeight: 1.5 }}>
            Trash is empty. Deleted photos will appear here.
          </div>
        ) : (
          assets.map((asset) => {
            const left = daysLeft(asset.deletedAt);
            return (
              <div
                key={asset.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 8px",
                  borderRadius: 3,
                }}
                className="am-mi"
              >
                <span
                  aria-hidden="true"
                  style={{
                    flex: "0 0 auto",
                    width: 44,
                    height: 44,
                    borderRadius: 2,
                    border: "1px solid var(--bd)",
                    background: "var(--bg-in)",
                    backgroundImage: asset.thumb ? `url(${asset.thumb})` : undefined,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {asset.name}
                  </div>
                  <div style={{ fontSize: 10, color: left !== null && left <= 3 ? "var(--red)" : "var(--t3)", marginTop: 2 }}>
                    {left === null ? "in trash" : left === 0 ? "removed today" : `${left} day${left === 1 ? "" : "s"} left`}
                  </div>
                </div>
                <div style={{ flex: "0 0 auto", display: "flex", gap: 2 }}>
                  <button style={textBtn("var(--ac)")} onClick={() => onRestore([asset.id])}>
                    Restore
                  </button>
                  <button style={textBtn("var(--red)")} onClick={() => onPurge([asset.id])}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {count > 0 && assets && (
        <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--bd)" }}>
          <button
            style={{ ...textBtn("var(--ac)"), padding: "6px 10px", border: "1px solid var(--bd)" }}
            onClick={() => onRestore(assets.map((a) => a.id))}
          >
            Restore all
          </button>
          <button
            style={{ ...textBtn("var(--red)"), padding: "6px 10px", border: "1px solid var(--bd)" }}
            onClick={() => onPurge(assets.map((a) => a.id))}
          >
            Empty trash
          </button>
        </div>
      )}
    </div>
  );
}
