import type { TrashItem } from "@archivemind/shared";
import { CheckIcon, TrashIcon } from "@/components/icons/icons";
import { formatBytes } from "@/lib/usage-format";
import { trashCountLabel, trashExpiry, trashLocationLabel, trashTypeLabel } from "@/lib/trash-view";
import TrashGlyph from "./TrashGlyph";

/** The grid card. Photos are what a photo archive's Trash is mostly made of, so
 *  the default view stays a contact sheet — but the card carries what the old
 *  one never did: what kind of thing it is, where Restore puts it back, and a
 *  countdown that turns red before it matters. */
export default function TrashItemCard({
  item,
  selected,
  onToggle,
  onRestore,
  onPurge,
}: {
  item: TrashItem;
  selected: boolean;
  onToggle: () => void;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const expiry = trashExpiry(item.deletedAt);
  const type = trashTypeLabel(item);
  const where = trashLocationLabel(item);
  const count = trashCountLabel(item);

  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-s)",
        border: `1px solid ${selected ? "var(--ac)" : "var(--bd)"}`,
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          height: 96,
          background: item.thumb ? `url(${item.thumb}) center/cover` : "var(--bg-el)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!item.thumb && <TrashGlyph item={item} size={26} />}

        <button
          onClick={onToggle}
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select ${item.name}`}
          style={{
            position: "absolute",
            top: 6,
            left: 6,
            display: "flex",
            width: 16,
            height: 16,
            alignItems: "center",
            justifyContent: "center",
            background: selected ? "var(--ac)" : "rgba(10,10,10,.6)",
            border: `1px solid ${selected ? "var(--ac)" : "var(--bdh)"}`,
            borderRadius: 2,
            cursor: "pointer",
            padding: 0,
          }}
        >
          {selected && <CheckIcon stroke="#050505" />}
        </button>

        {/* Only for the things a thumbnail cannot explain — a photo is obvious. */}
        {type !== "Photo" && (
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              padding: "1px 5px",
              background: "rgba(10,10,10,.72)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--t2)",
            }}
          >
            {type}
          </span>
        )}
      </div>

      <div style={{ padding: "8px 10px" }}>
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
          title={`Restores to ${where}`}
          style={{
            marginTop: 2,
            fontSize: 10,
            color: "var(--t2b)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {where}
          {count ? ` · ${count}` : ""}
          {item.bytes != null ? ` · ${formatBytes(item.bytes)}` : ""}
        </div>
        <div style={{ marginTop: 2, fontSize: 10, color: expiry.urgent ? "var(--red)" : "var(--t2)" }}>
          {expiry.label}
        </div>

        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            onClick={onRestore}
            style={{
              flex: 1,
              height: 24,
              background: "var(--bg-el)",
              color: "var(--t1)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              fontSize: 10.5,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Restore
          </button>
          <button
            onClick={onPurge}
            aria-label={`Delete ${item.name} permanently`}
            title="Delete permanently"
            style={{
              flex: "0 0 auto",
              height: 24,
              padding: "0 8px",
              background: "transparent",
              color: "var(--red)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              fontSize: 10.5,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <TrashIcon width={11} height={11} />
          </button>
        </div>
      </div>
    </div>
  );
}
