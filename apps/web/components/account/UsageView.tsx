"use client";

import Link from "next/link";
import { useState } from "react";
import { TRASH_RETENTION_DAYS } from "@archivemind/shared";
import {
  activityAmount,
  eventLabel,
  formatBytes,
  formatCount,
  formatDay,
  formatResetDate,
  percentOf,
  segmentPercent,
  sourceLabel,
} from "@/lib/usage-format";
import type { UsageSnapshot } from "@/lib/usage";

/** Usage & Storage (migration 20260727000002). Three questions, in order:
 *  how much room is left, how many credits are left, and what is still
 *  unprocessed — then attribution and the audit trail underneath.
 *
 *  Renders as the BODY of a homepage view, not as its own page: the sidebar,
 *  the shell and the `<h1>` all come from HomeClient, exactly like Archived and
 *  Trash. An account page with its own chrome would have been a second layout
 *  for the same signed-in surface, and the sidebar is where people already look
 *  for Trash — which is half of what this page is about.
 *
 *  Every number here comes from `workspace_usage()`. Where the database cannot
 *  yet answer honestly (derivative rows written before byte tracking existed)
 *  the card says so rather than rendering a confident under-count.
 *
 *  Inline styles per ADR 0001 — this is workspace UI, not the marketing page. */

const RAMP = ["rgba(236,238,232,.92)", "rgba(236,238,232,.62)", "rgba(236,238,232,.40)", "rgba(236,238,232,.24)"];
const TRASH_FILL = "repeating-linear-gradient(45deg, rgba(255,68,68,.55) 0 3px, transparent 3px 6px)";

const card: React.CSSProperties = {
  border: "1px solid var(--bd)",
  borderRadius: 3,
  background: "var(--bg-s)",
  padding: 14,
};
const label: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".12em",
  color: "var(--t3)",
};
const bigNumber: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 700,
  color: "var(--t1)",
  letterSpacing: "-.01em",
};
const noteRow: React.CSSProperties = {
  marginTop: 11,
  paddingTop: 10,
  borderTop: "1px solid var(--bd)",
  color: "var(--t2)",
  fontSize: 10.5,
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "baseline",
};
const cell: React.CSSProperties = {
  padding: "7px 0",
  borderTop: "1px solid var(--bd)",
  textAlign: "right",
  color: "var(--t2)",
  whiteSpace: "nowrap",
};
const headCell: React.CSSProperties = {
  fontSize: 9.5,
  letterSpacing: ".12em",
  color: "var(--t3)",
  textAlign: "right",
  fontWeight: 400,
  padding: "0 0 7px",
};

interface Segment {
  key: string;
  name: string;
  bytes: number;
  fill: string;
}

export default function UsageView({ usage }: { usage: UsageSnapshot }) {
  const [tab, setTab] = useState<"project" | "source">("project");

  const { plan, storage, credits, archive } = usage;
  const storageLimit = plan?.storage_bytes ?? null;
  const creditLimit = plan?.monthly_credits ?? null;

  const segments: Segment[] = [
    { key: "originals", name: "Originals", bytes: storage.originals, fill: RAMP[0] },
    { key: "previews", name: "Previews", bytes: storage.previews, fill: RAMP[1] },
    { key: "edits", name: "Edits", bytes: storage.edits, fill: RAMP[2] },
    { key: "exports", name: "Exports", bytes: storage.exports, fill: RAMP[3] },
    { key: "trash", name: "Trash", bytes: storage.trash, fill: TRASH_FILL },
  ].filter((s) => s.bytes > 0);

  const creditSegments = [
    { key: "analyze", name: "Analyze", units: credits.analyze, fill: RAMP[0] },
    { key: "captions", name: "Captions", units: credits.captions, fill: RAMP[1] },
  ].filter((s) => s.units > 0);

  const unmeasured =
    storage.unmeasured.previews + storage.unmeasured.edits + storage.unmeasured.exports;
  const notAnalyzed = Math.max(0, archive.photos - archive.analyzed);
  const maxDaily = Math.max(1, ...usage.daily.map((d) => d.credits));

  return (
    <div style={{ fontSize: 12 }}>
        {/* ── the two meters ─────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
          <section style={card}>
            <div style={{ ...label, marginBottom: 10 }}>STORAGE</div>
            <div style={bigNumber}>
              {formatBytes(storage.total)}
              {storageLimit != null && (
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--t2)", letterSpacing: 0 }}>
                  {" "}
                  / {formatBytes(storageLimit)}
                </span>
              )}
            </div>
            <Meter>
              {segments.map((s) => (
                <div
                  key={s.key}
                  style={{
                    width: `${segmentPercent(s.bytes, storageLimit, storage.total)}%`,
                    height: "100%",
                    background: s.fill,
                  }}
                />
              ))}
            </Meter>
            <Keys
              items={
                segments.length > 0
                  ? segments.map((s) => ({ key: s.key, fill: s.fill, text: `${s.name} ${formatBytes(s.bytes)}` }))
                  : [{ key: "empty", fill: RAMP[3], text: "Nothing stored yet" }]
              }
            />
            <div style={noteRow}>
              <span>
                {storage.trash > 0
                  ? `${formatBytes(storage.trash)} in Trash — freed automatically within ${TRASH_RETENTION_DAYS} days`
                  : storage.linked > 0
                    ? `${formatBytes(storage.linked)} more stays in Google Drive and costs you nothing`
                    : "Originals, previews, edits and export files"}
              </span>
              {percentOf(storage.total, storageLimit) != null && (
                <span style={{ color: "var(--t1)", whiteSpace: "nowrap" }}>
                  {Math.round(percentOf(storage.total, storageLimit)!)}% used
                </span>
              )}
            </div>
            {unmeasured > 0 && (
              <div style={{ marginTop: 8, fontSize: 10, color: "var(--t3)", lineHeight: 1.5 }}>
                {formatCount(unmeasured)} file(s) written before we started recording sizes are not in
                this total yet.
              </div>
            )}
          </section>

          <section style={card}>
            <div style={{ ...label, marginBottom: 10 }}>
              AI CREDITS · THIS MONTH
            </div>
            <div style={bigNumber}>
              {formatCount(credits.total)}
              <span style={{ fontSize: 12, fontWeight: 400, color: "var(--t2)", letterSpacing: 0 }}>
                {creditLimit != null ? ` / ${formatCount(creditLimit)}` : " credits"} · resets{" "}
                {formatResetDate(usage.period.end)}
              </span>
            </div>
            <Meter>
              {creditSegments.map((s) => (
                <div
                  key={s.key}
                  style={{
                    width: `${segmentPercent(s.units, creditLimit, Math.max(1, credits.total))}%`,
                    height: "100%",
                    background: s.fill,
                  }}
                />
              ))}
            </Meter>
            <Keys
              items={[
                ...(creditSegments.length > 0
                  ? creditSegments.map((s) => ({
                      key: s.key,
                      fill: s.fill,
                      text: `${s.name} ${formatCount(s.units)}`,
                    }))
                  : [{ key: "empty", fill: RAMP[3], text: "No AI runs this month" }]),
                { key: "free", fill: "transparent", text: "Search & export — free", muted: true },
              ]}
            />
            <div style={noteRow}>
              <span>1 credit = 1 AI action on 1 photo</span>
              <span style={{ color: "var(--t2)", whiteSpace: "nowrap" }}>
                {formatCount(credits.searches)} searches
              </span>
            </div>
          </section>
        </div>

        {/* ── archive funnel ─────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            marginTop: 12,
            border: "1px solid var(--bd)",
            borderRadius: 3,
            background: "var(--bg-s)",
            overflow: "hidden",
          }}
        >
          <Funnel value={archive.photos} caption="PHOTOS" />
          <Funnel value={archive.analyzed} caption="ANALYZED" share={share(archive.analyzed, archive.photos)} />
          <Funnel value={archive.captioned} caption="CAPTIONED" share={share(archive.captioned, archive.photos)} />
          <Funnel value={archive.facts_confirmed} caption="FACTS CONFIRMED" />
          <div
            style={{
              flex: "1 1 220px",
              padding: "13px 14px",
              background: "var(--bg-el)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {notAnalyzed > 0 ? (
              <>
                <div style={{ color: "var(--t2)", fontSize: 10.5, lineHeight: 1.4 }}>
                  {formatCount(notAnalyzed)} photo(s) not analyzed yet ≈ {formatCount(notAnalyzed)} credits
                </div>
                {/* Deliberately a link to the canvas, not a one-click "analyze
                    everything": AI spend stays a deliberate, selected action
                    (product decision 2026-07-10). */}
                <Link
                  href="/projects/all"
                  style={{
                    border: "1px solid var(--bdh)",
                    borderRadius: 2,
                    padding: "6px 10px",
                    fontSize: 11,
                    textAlign: "center",
                    color: "var(--t1)",
                    textDecoration: "none",
                  }}
                >
                  Analyze them on the canvas →
                </Link>
              </>
            ) : (
              <div style={{ color: "var(--t2)", fontSize: 10.5, lineHeight: 1.4 }}>
                {archive.photos > 0
                  ? "Every photo in this archive has been analyzed."
                  : "Upload or import photos to get started."}
              </div>
            )}
          </div>
        </div>

        {/* ── attribution + activity ─────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          <section style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div style={label}>WHERE IT GOES</div>
              <div style={{ display: "flex", gap: 14, fontSize: 10.5, letterSpacing: ".08em" }}>
                <Tab active={tab === "project"} onClick={() => setTab("project")}>
                  BY PROJECT
                </Tab>
                <Tab active={tab === "source"} onClick={() => setTab("source")}>
                  BY SOURCE
                </Tab>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              {tab === "project" ? (
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th style={{ ...headCell, textAlign: "left" }}>PROJECT</th>
                      <th style={headCell}>PHOTOS</th>
                      <th style={headCell}>STORAGE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.by_project.map((p) => (
                      <tr key={p.id}>
                        <td style={{ ...cell, textAlign: "left", color: "var(--t1)", whiteSpace: "normal" }}>
                          {p.name}
                        </td>
                        <td style={cell}>{formatCount(p.photos)}</td>
                        <td style={cell}>{formatBytes(p.bytes)}</td>
                      </tr>
                    ))}
                    {usage.unassigned.photos > 0 && (
                      <tr>
                        <td style={{ ...cell, textAlign: "left", color: "var(--t3)", whiteSpace: "normal" }}>
                          Not in any project
                        </td>
                        <td style={cell}>{formatCount(usage.unassigned.photos)}</td>
                        <td style={cell}>{formatBytes(usage.unassigned.bytes)}</td>
                      </tr>
                    )}
                    {usage.by_project.length === 0 && usage.unassigned.photos === 0 && <EmptyRow cols={3} />}
                  </tbody>
                </table>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <thead>
                    <tr>
                      <th style={{ ...headCell, textAlign: "left" }}>SOURCE</th>
                      <th style={headCell}>PHOTOS</th>
                      <th style={headCell}>IN YOUR STORAGE</th>
                      <th style={headCell}>STAYS IN CLOUD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.by_source.map((s) => (
                      <tr key={s.origin}>
                        <td style={{ ...cell, textAlign: "left", color: "var(--t1)", whiteSpace: "normal" }}>
                          {sourceLabel(s.origin)}
                        </td>
                        <td style={cell}>{formatCount(s.photos)}</td>
                        <td style={cell}>{formatBytes(s.stored_bytes)}</td>
                        <td style={cell}>{s.linked_bytes > 0 ? formatBytes(s.linked_bytes) : "—"}</td>
                      </tr>
                    ))}
                    {usage.by_source.length === 0 && <EmptyRow cols={4} />}
                  </tbody>
                </table>
              )}
            </div>

            <div style={noteRow}>
              <span>
                {tab === "project"
                  ? "A photo in two projects counts in both, so these don't sum to the total."
                  : "Google Drive originals stay in Drive — only their previews use your storage."}
              </span>
            </div>
          </section>

          <section style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
              <div style={label}>ACTIVITY · LAST 30 DAYS</div>
              <span style={{ fontSize: 10.5, color: "var(--t2)" }}>
                {formatCount(usage.daily.reduce((n, d) => n + d.credits, 0))} credits
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 46, margin: "14px 0 8px" }}>
              {usage.daily.map((d) => (
                <div
                  key={d.day}
                  title={`${formatDay(d.day)} — ${formatCount(d.credits)} credits`}
                  style={{
                    flex: 1,
                    minHeight: 2,
                    height: `${Math.max(4, (d.credits / maxDaily) * 100)}%`,
                    background: d.credits > 0 ? "rgba(236,238,232,.55)" : "rgba(236,238,232,.10)",
                    borderRadius: "1px 1px 0 0",
                  }}
                />
              ))}
            </div>

            <div>
              {usage.recent.map((r, i) => (
                <div
                  key={`${r.event_type}-${r.at}-${i}`}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "6px 0",
                    borderTop: "1px solid var(--bd)",
                    color: "var(--t2)",
                    fontSize: 10.5,
                  }}
                >
                  <span style={{ color: "var(--t3)", flex: "0 0 54px" }}>{formatDay(r.at)}</span>
                  <span style={{ color: "var(--t1)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {eventLabel(r.event_type)}
                    {r.project ? ` · ${r.project}` : ""}
                  </span>
                  <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {activityAmount(r.event_type, r.units, r.bytes) ?? ""}
                  </span>
                </div>
              ))}
              {usage.recent.length === 0 && (
                <div style={{ padding: "10px 0", borderTop: "1px solid var(--bd)", color: "var(--t3)", fontSize: 10.5 }}>
                  Nothing here yet — uploads, analysis and exports show up as you work.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ── plan footer ────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 12,
            padding: "11px 14px",
            border: "1px dashed var(--bd)",
            borderRadius: 3,
            color: "var(--t2)",
            fontSize: 10.5,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>
            Plan: <b style={{ color: "var(--t1)", fontWeight: 400 }}>{plan?.name ?? "—"}</b>
            {plan && !plan.enforced && " — nothing is capped yet, we only count."}
          </span>
          <span style={{ color: "var(--t3)" }}>Billing arrives with the first paid plan.</span>
        </div>
    </div>
  );
}

/** The plan chip. Lives beside the view title in HomeClient's header row —
 *  the same slot "+ New project" occupies on the project views — because
 *  "which plan am I on" belongs next to the page name, not buried under the
 *  meters it explains. */
export function UsagePlanPill({ plan }: { plan: UsageSnapshot["plan"] }) {
  return (
    <span
      style={{
        border: "1px solid var(--bdh)",
        borderRadius: 2,
        padding: "4px 9px",
        fontSize: 10,
        letterSpacing: ".08em",
        color: "var(--t2)",
        whiteSpace: "nowrap",
      }}
    >
      {plan && plan.enforced ? plan.name.toUpperCase() : "BETA · NO LIMITS ENFORCED"}
    </span>
  );
}

function share(part: number, whole: number): string | undefined {
  if (whole <= 0) return undefined;
  return `${Math.round((part / whole) * 100)}%`;
}

function Meter({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        height: 10,
        margin: "12px 0 10px",
        background: "var(--bg-el)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

function Keys({ items }: { items: { key: string; fill: string; text: string; muted?: boolean }[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 10.5 }}>
      {items.map((it) => (
        <div
          key={it.key}
          style={{ display: "flex", alignItems: "center", gap: 6, color: it.muted ? "var(--t3)" : "var(--t2)" }}
        >
          {it.fill !== "transparent" && (
            <i style={{ width: 8, height: 8, borderRadius: 1, background: it.fill, flex: "0 0 auto" }} />
          )}
          {it.text}
        </div>
      ))}
    </div>
  );
}

function Funnel({ value, caption, share: pct }: { value: number; caption: string; share?: string }) {
  return (
    <div style={{ flex: "1 1 140px", padding: "13px 14px", borderRight: "1px solid var(--bd)" }}>
      <div style={{ fontSize: 17, fontWeight: 700, color: "var(--t1)" }}>{formatCount(value)}</div>
      <div style={{ ...label, marginTop: 3 }}>
        {caption}
        {pct ? ` · ${pct}` : ""}
      </div>
      {pct && (
        <div style={{ height: 4, background: "var(--bg-el)", borderRadius: 2, marginTop: 8, overflow: "hidden" }}>
          <i style={{ display: "block", height: "100%", width: pct, background: "rgba(236,238,232,.7)" }} />
        </div>
      )}
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: 0,
        padding: "0 0 2px",
        cursor: "pointer",
        fontFamily: "inherit",
        fontSize: 10.5,
        letterSpacing: ".08em",
        color: active ? "var(--t1)" : "var(--t3)",
        borderBottom: active ? "1px solid var(--t1)" : "1px solid transparent",
      }}
    >
      {children}
    </button>
  );
}

function EmptyRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} style={{ ...cell, textAlign: "left", color: "var(--t3)" }}>
        Nothing here yet.
      </td>
    </tr>
  );
}
