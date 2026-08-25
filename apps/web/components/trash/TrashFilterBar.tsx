import type { TrashFilterKey, TrashSort } from "@archivemind/shared";
import { SearchIcon } from "@/components/icons/icons";
import Dropdown from "@/components/ui/Dropdown";
import SegmentedTrack from "@/components/ui/SegmentedTrack";
import { trashChips } from "@/lib/trash-view";
import type { TrashMode } from "@/hooks/useTrash";

const SORTS: { value: TrashSort; label: string }[] = [
  { value: "recent", label: "Recently deleted" },
  { value: "expiring", label: "Expiring soon" },
  { value: "largest", label: "Largest" },
  { value: "name", label: "Name" },
];

/** The Trash's own controls, above the content rather than in the sidebar —
 *  where the homepage's project search used to filter this list under a
 *  placeholder that said "Search projects…" (ADR 0049).
 *
 *  Chips are drawn from the counts the server returns, so a workspace with no
 *  PDFs never shows a PDF chip, and a future asset kind shows up on its own. */
export default function TrashFilterBar({
  counts,
  types,
  onToggleType,
  query,
  onQuery,
  sort,
  onSort,
  expiringOnly,
  onExpiringOnly,
  expiringCount,
  mode,
  onMode,
  showMode = true,
}: {
  counts: Record<string, number>;
  types: TrashFilterKey[];
  onToggleType: (key: TrashFilterKey) => void;
  query: string;
  onQuery: (value: string) => void;
  sort: TrashSort;
  onSort: (value: TrashSort) => void;
  expiringOnly: boolean;
  onExpiringOnly: (value: boolean) => void;
  expiringCount: number;
  mode: TrashMode;
  onMode: (mode: TrashMode) => void;
  showMode?: boolean;
}) {
  const chips = trashChips(counts);

  const chipStyle = (active: boolean): React.CSSProperties => ({
    height: 26,
    padding: "0 10px",
    background: active ? "var(--ac)" : "var(--bg-s)",
    color: active ? "#050505" : "var(--t2)",
    border: `1px solid ${active ? "var(--ac)" : "var(--bd)"}`,
    borderRadius: 2,
    fontSize: 11,
    fontWeight: active ? 700 : 400,
    letterSpacing: ".02em",
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 200px", minWidth: 160, maxWidth: 320 }}>
          <span style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", display: "flex", color: "var(--t3)" }}>
            <SearchIcon width={13} height={13} />
          </span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search trash…"
            aria-label="Search trash"
            style={{
              width: "100%",
              height: 30,
              padding: "0 8px 0 26px",
              background: "var(--bg-in)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              color: "var(--t1)",
              fontSize: 12,
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--t2)" }}>
          <span style={{ color: "var(--t3)" }}>Sort</span>
          <Dropdown<TrashSort>
            value={sort}
            options={SORTS}
            onChange={onSort}
            ariaLabel="Sort trash"
            width={168}
          />
        </div>

        <div style={{ flex: 1 }} />

        {showMode && (
          <SegmentedTrack<TrashMode>
            value={mode}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
            onChange={onMode}
            style={{ flex: "0 0 auto", width: 128 }}
          />
        )}
      </div>

      {(chips.length > 1 || expiringCount > 0) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {chips.map((chip) => {
            const active = types.includes(chip.key);
            return (
              <button
                key={chip.key}
                onClick={() => onToggleType(chip.key)}
                aria-pressed={active}
                style={chipStyle(active)}
              >
                {chip.label}{" "}
                <span style={{ opacity: active ? 0.7 : 0.55 }}>{chip.count}</span>
              </button>
            );
          })}
          {expiringCount > 0 && (
            <button
              onClick={() => onExpiringOnly(!expiringOnly)}
              aria-pressed={expiringOnly}
              // Its own control rather than a sort, because "what am I about to
              // lose" is a different question from "how is this ordered".
              style={{
                ...chipStyle(expiringOnly),
                color: expiringOnly ? "#050505" : "var(--red)",
                borderColor: expiringOnly ? "var(--ac)" : "var(--bd)",
              }}
            >
              Expiring soon <span style={{ opacity: 0.7 }}>{expiringCount}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
