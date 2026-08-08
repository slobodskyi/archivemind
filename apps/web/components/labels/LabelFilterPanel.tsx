import { useCallback, useEffect, useRef, useState } from "react";
import { ASSET_LABELS, type AssetLabel, type LabelNames } from "@archivemind/shared";
import { LABEL_COLORS, NO_LABEL_COLOR, type LabelFilter } from "@/lib/labels";
import { Z } from "@/lib/ui";

interface LabelFilterPanelProps {
  open: boolean;
  names: LabelNames;
  counts: Record<AssetLabel | "none", number>;
  active: LabelFilter;
  total: number;
  onSelect: (filter: LabelFilter) => void;
  onRename: (label: AssetLabel, name: string) => void;
  onClose: () => void;
}

/** The label filter, anchored beside the left toolbar. Two jobs in one surface,
 *  because they are the same list: click a colour to show only those photos,
 *  double-click its NAME to rename the colour for the whole workspace.
 *
 *  The rename lives here rather than in a settings page because this is the only
 *  place the seven names are ever read as a set — and the same double-click
 *  gesture already renames a Topic cloud (ADR 0038), so it costs nothing to
 *  learn twice. Filtering is per-session and never persisted: a saved filter is
 *  a canvas that looks empty for reasons the next visit cannot explain. */
export default function LabelFilterPanel({
  open,
  names,
  counts,
  active,
  total,
  onSelect,
  onRename,
  onClose,
}: LabelFilterPanelProps) {
  const [editing, setEditing] = useState<AssetLabel | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const commit = useCallback(() => {
    if (!editing) return;
    const label = editing;
    setEditing(null);
    const trimmed = draft.trim();
    // Unchanged text is not a write. Unlike the Topic rename there is no
    // is_renamed flag to pin here — the row's existence IS the pin, so
    // re-saving the same string would only add a row that changes nothing.
    if (trimmed !== names[label]) onRename(label, trimmed);
  }, [draft, editing, names, onRename]);

  // The outside-press listener is registered once per open; keep the latest
  // commit in a ref so it can never fire a stale draft.
  const commitRef = useRef(commit);
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  // Close the panel on any press outside it, committing an open rename with it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = panelRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      commitRef.current();
      onClose();
    };
    // Capture phase, same reason as the cloud rename: the canvas handlers call
    // preventDefault(), which suppresses the focus change a blur relies on.
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const rows: { key: LabelFilter; color: string; name: string; count: number; label: AssetLabel | null }[] = [
    ...ASSET_LABELS.map((label) => ({
      key: label as LabelFilter,
      color: LABEL_COLORS[label],
      name: names[label],
      count: counts[label] ?? 0,
      label,
    })),
    { key: "none" as LabelFilter, color: NO_LABEL_COLOR, name: "No label", count: counts.none ?? 0, label: null },
  ];

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Filter by label"
      style={{
        position: "absolute",
        left: 74, // clears the 46px toolbar at left:20 plus a gutter
        top: "50%",
        transform: "translateY(-50%)",
        width: 218,
        padding: 6,
        background: "rgba(18,18,18,.97)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(20px)",
        boxShadow: "0 20px 60px rgba(0,0,0,.7)",
        zIndex: Z.menu,
      }}
    >
      <div
        style={{
          padding: "5px 8px 7px",
          color: "var(--t3)",
          fontSize: 9.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        Labels
      </div>

      <Row
        active={active === null}
        color={null}
        name="All files"
        count={total}
        onClick={() => onSelect(null)}
      />
      <div style={{ height: 1, background: "var(--bd)", margin: "5px 4px" }} />

      {rows.map((row) => (
        <Row
          key={String(row.key)}
          active={active === row.key}
          color={row.color}
          name={row.name}
          count={row.count}
          editing={editing === row.label}
          draft={draft}
          inputRef={inputRef}
          onClick={() => onSelect(row.key)}
          // Only a colour can be renamed: "No label" is the absence of one.
          onStartRename={
            row.label
              ? () => {
                  setEditing(row.label);
                  setDraft(names[row.label as AssetLabel]);
                }
              : undefined
          }
          onDraft={setDraft}
          onCommit={commit}
          onCancel={() => setEditing(null)}
        />
      ))}

      <div style={{ padding: "7px 8px 4px", color: "var(--t3)", fontSize: 10, lineHeight: 1.4 }}>
        1–7 marks the selection, 0 clears it. Double-click a name to rename.
      </div>
    </div>
  );
}

function Row({
  active,
  color,
  name,
  count,
  editing,
  draft,
  inputRef,
  onClick,
  onStartRename,
  onDraft,
  onCommit,
  onCancel,
}: {
  active: boolean;
  color: string | null;
  name: string;
  count: number;
  editing?: boolean;
  draft?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onClick: () => void;
  onStartRename?: () => void;
  onDraft?: (v: string) => void;
  onCommit?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div
      onClick={editing ? undefined : onClick}
      onDoubleClick={onStartRename}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!editing && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "7px 8px",
        borderRadius: 2,
        cursor: editing ? "text" : "pointer",
        background: active ? "color-mix(in srgb,var(--ac) 10%,transparent)" : "transparent",
        // A count of 0 stays clickable but reads as empty — filtering to it is a
        // legitimate way to confirm nothing carries that colour.
        opacity: count === 0 && !active ? 0.55 : 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 10,
          height: 10,
          flex: "0 0 auto",
          borderRadius: "50%",
          background: color ?? "transparent",
          border: color ? "none" : "1px solid var(--bdh)",
        }}
      />
      {editing ? (
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          maxLength={40}
          onChange={(e) => onDraft?.(e.target.value)}
          onKeyDown={(e) => {
            // Escape closes panels app-wide and the digits are label shortcuts —
            // neither may reach the window while a name is being typed.
            e.stopPropagation();
            if (e.key === "Enter") onCommit?.();
            else if (e.key === "Escape") onCancel?.();
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            minWidth: 0,
            font: "inherit",
            fontSize: 12.5,
            color: "var(--t1)",
            background: "var(--bg-el)",
            border: "1px solid var(--bdh)",
            borderRadius: 2,
            padding: "1px 4px",
            outline: "none",
          }}
        />
      ) : (
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: active ? "var(--t1)" : "var(--t2)",
            fontSize: 12.5,
          }}
        >
          {name}
        </span>
      )}
      <span style={{ color: "var(--t3)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{count}</span>
    </div>
  );
}
