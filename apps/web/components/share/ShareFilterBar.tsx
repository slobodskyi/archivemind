"use client";

import { useState, type CSSProperties } from "react";
import { DEFAULT_LABEL_NAMES } from "@archivemind/shared";
import { LABEL_COLORS } from "@/lib/labels";
import type { ShareDetails } from "@/lib/project-shares";
import { activeShareFilters, type ProjectShareFacets, type ProjectShareFilter } from "@/lib/project-share-public";
import { MONO, shareChip } from "./share-ui";

/** Tags shown before "More tags": the facet already stops at 40. */
const TAGS_FOLDED = 16;

const rowStyle: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 };

const rowLabel: CSSProperties = {
  minWidth: 92,
  color: "var(--t3)",
  fontFamily: MONO,
  fontSize: 9,
  letterSpacing: ".07em",
  textTransform: "uppercase",
};

function Count({ value }: { value: number }) {
  return <span style={{ color: "var(--t3)" }}>{value.toLocaleString("en-US")}</span>;
}

/** Whether the page has a filter row at all: a detail the link shows that has
 *  something to count. */
export function hasShareFilters(details: ShareDetails, facets: ProjectShareFacets): boolean {
  return (
    (details.boards && facets.boards.length > 0) ||
    (details.labels && facets.labels.length > 0) ||
    (details.tags && facets.tags.length > 0)
  );
}

/** The recipient's filter row (ADR 0053 §4): Workspaces, the seven colours and
 *  the most-used tags — each only when the link shows that detail, each with
 *  the number of the link's files that carry it, counted in SQL. One value per
 *  row at a time; rows combine. Pressing the pressed chip clears its row. */
export default function ShareFilterBar({
  details,
  facets,
  filter,
  busy,
  onChange,
}: {
  details: ShareDetails;
  facets: ProjectShareFacets;
  filter: ProjectShareFilter;
  busy: boolean;
  onChange: (filter: ProjectShareFilter) => void;
}) {
  const [allTags, setAllTags] = useState(false);
  if (!hasShareFilters(details, facets)) return null;

  const set = (patch: ProjectShareFilter) => onChange({ ...filter, ...patch });
  // A picked tag stays visible even past the fold — or outside the top 40
  // altogether, when it was picked from a file's own tags in the lightbox.
  const folded = allTags
    ? facets.tags
    : facets.tags.filter((tag, index) => index < TAGS_FOLDED || tag.name === filter.tag);
  const tags: { name: string; count: number | null }[] =
    filter.tag && !facets.tags.some((tag) => tag.name === filter.tag)
      ? [{ name: filter.tag, count: null }, ...folded]
      : folded;
  const active = activeShareFilters(filter);

  return (
    <div
      role="group"
      aria-label="Filter files"
      aria-busy={busy}
      style={{
        display: "grid",
        gap: 10,
        marginTop: 26,
        padding: "14px 0",
        borderTop: "1px solid var(--bd)",
        borderBottom: "1px solid var(--bd)",
      }}
    >
      {details.boards && facets.boards.length ? (
        <div style={rowStyle}>
          <span style={rowLabel}>Workspaces</span>
          {facets.boards.map((board) => {
            const pressed = filter.board === board.id;
            return (
              <button
                key={board.id}
                type="button"
                aria-pressed={pressed}
                onClick={() => set({ board: pressed ? undefined : board.id })}
                style={shareChip(pressed)}
              >
                {board.color ? (
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: LABEL_COLORS[board.color] }} />
                ) : null}
                <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{board.name}</span>
                <Count value={board.count} />
              </button>
            );
          })}
        </div>
      ) : null}

      {details.labels && facets.labels.length ? (
        <div style={rowStyle}>
          <span style={rowLabel}>Colour</span>
          {facets.labels.map(({ label, count }) => {
            const pressed = filter.label === label;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={pressed}
                aria-label={`${DEFAULT_LABEL_NAMES[label]} · ${count} ${count === 1 ? "file" : "files"}`}
                title={DEFAULT_LABEL_NAMES[label]}
                onClick={() => set({ label: pressed ? undefined : label })}
                style={shareChip(pressed)}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: LABEL_COLORS[label],
                    boxShadow: pressed ? `0 0 0 2px var(--bg), 0 0 0 3px ${LABEL_COLORS[label]}` : undefined,
                  }}
                />
                <Count value={count} />
              </button>
            );
          })}
        </div>
      ) : null}

      {details.tags && (facets.tags.length || filter.tag) ? (
        <div style={rowStyle}>
          <span style={rowLabel}>Tags</span>
          {tags.map((tag) => {
            const pressed = filter.tag === tag.name;
            return (
              <button
                key={tag.name}
                type="button"
                aria-pressed={pressed}
                onClick={() => set({ tag: pressed ? undefined : tag.name })}
                style={shareChip(pressed)}
              >
                <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{tag.name}</span>
                {tag.count !== null ? <Count value={tag.count} /> : null}
              </button>
            );
          })}
          {facets.tags.length > TAGS_FOLDED ? (
            <button
              type="button"
              aria-expanded={allTags}
              onClick={() => setAllTags((open) => !open)}
              style={{ ...shareChip(false), borderStyle: "dashed" }}
            >
              {allTags ? "Fewer tags" : `More tags (${facets.tags.length - TAGS_FOLDED})`}
            </button>
          ) : null}
        </div>
      ) : null}

      {active ? (
        <div style={rowStyle}>
          <span style={rowLabel} />
          <button type="button" onClick={() => onChange({})} style={{ ...shareChip(false), color: "var(--t1)" }}>
            Clear {active === 1 ? "filter" : `${active} filters`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
