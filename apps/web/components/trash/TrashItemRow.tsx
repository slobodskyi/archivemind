import type { TrashItem } from "@archivemind/shared";
import { CheckIcon } from "@/components/icons/icons";
import { formatBytes, formatDay } from "@/lib/usage-format";
import { trashCountLabel, trashExpiry, trashLocationLabel, trashTypeLabel } from "@/lib/trash-view";
import TrashGlyph from "./TrashGlyph";

/** The list row — the shape a file manager's trash has, because that is what a
 *  mixed archive needs: a PDF and a Workspace have nothing to show in a
 *  contact sheet, but they have plenty to say in a line. Shared by the homepage
 *  view's list mode and the in-canvas panel, which has only ever been a list.
 *
 *  `compact` drops the columns that a 360px panel cannot hold. */
export default function TrashItemRow({
  item,
  selected,
  compact = false,
  onToggle,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  selected: boolean;
  compact?: boolean;
  onToggle?: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const expiry = trashExpiry(item.deletedAt);
  const where = trashLocationLabel(item);
  const count = trashCountLabel(item);

  const action = (color: string): React.CSSProperties => ({
    border: 0,
    background: "transparent",
    color,
    cursor: "pointer",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: ".04em",
    fontFamily: "inherit",
    padding: "3px 6px",
    borderRadius: 2,
  });

  return (
    <div
      className="am-mi"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: compact ? "7px 8px" : "8px 10px",
        borderRadius: 3,
        background: selected ? "var(--bg-el)" : undefined,
      }}
    >
      {onToggle && (
        <button
          onClick={onToggle}
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${item.name}`}
          style={{
            display: "flex",
            flex: "0 0 auto",
            width: 15,
            height: 15,
            alignItems: "center",
            justifyContent: "center",
            background: selected ? "var(--ac)" : "transparent",
            border: `1px solid ${selected ? "var(--ac)" : "var(--bdh)"}`,
            borderRadius: 2,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {selected && <CheckIcon stroke="#050505" />}
        </button>
      )}

      <span
        aria-hidden="true"
        style={{
          display: "flex",
          flex: "0 0 auto",
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 2,
          border: "1px solid var(--bd)",
          background: "var(--bg-in)",
          backgroundImage: item.thumb ? `url(${item.thumb})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {!item.thumb && <TrashGlyph item={item} size={17} />}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={item.name}
          style={{
            fontSize: 11.5,
            color: "var(--t1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.name}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 10,
            color: "var(--t2b)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {/* Compact leads with the countdown: at 360px the line WILL be cut,
              and the one thing a panel exists to catch before it is gone must
              not be the half that disappears. */}
          {compact && (
            <span style={{ color: expiry.urgent ? "var(--red)" : "var(--t2b)" }}>
              {`${expiry.label} · `}
            </span>
          )}
          {trashTypeLabel(item)}
          {` · ${where}`}
          {count ? ` · ${count}` : ""}
          {!compact && item.bytes != null ? ` · ${formatBytes(item.bytes)}` : ""}
        </div>
      </div>

      {!compact && (
        <>
          <div style={{ flex: "0 0 auto", width: 86, fontSize: 10.5, color: "var(--t2b)" }}>
            {item.deletedBy?.name ?? "—"}
          </div>
          <div style={{ flex: "0 0 auto", width: 56, fontSize: 10.5, color: "var(--t2b)" }}>
            {formatDay(item.deletedAt)}
          </div>
          <div
            style={{
              flex: "0 0 auto",
              width: 86,
              fontSize: 10,
              color: expiry.urgent ? "var(--red)" : "var(--t2)",
            }}
          >
            {expiry.label}
          </div>
        </>
      )}

      <div style={{ flex: "0 0 auto", display: "flex", gap: 2 }}>
        <button style={action("var(--ac)")} onClick={onRestore}>
          Restore
        </button>
        <button style={action("var(--red)")} onClick={onPurge} title="Delete permanently">
          Delete
        </button>
      </div>
    </div>
  );
}
