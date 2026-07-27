/** Pure formatting for the Usage & Storage page. Separate from `lib/usage.ts`
 *  (which needs a Supabase client) so the arithmetic is unit-testable on its
 *  own — same split as `lib/search-tiers.ts`. */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** 1024-based, one decimal below 100. `null` renders as an em dash rather than
 *  "0 B": an unmeasured value and an empty one are different facts, and the
 *  storage card has both. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1) return "0 B";
  const i = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  const digits = i === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[i]}`;
}

/** Thousands separators without `Intl`: a locale-dependent format would differ
 *  between the server render and the browser one and trip hydration. */
export function formatCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Share of a limit, 0..100. Null when the plan has no limit — the UI drops the
 *  meter and shows a bare count, which is the honest rendering of "unlimited"
 *  and of the beta we ship in. */
export function percentOf(used: number, limit: number | null | undefined): number | null {
  if (limit == null || limit <= 0) return null;
  return Math.max(0, Math.min(100, (used / limit) * 100));
}

/** Segment width as a share of the whole meter (the limit, not the total), so
 *  the segments add up to the filled portion of the bar. Falls back to a share
 *  of the total when there is no limit. */
export function segmentPercent(part: number, limit: number | null | undefined, total: number): number {
  const denominator = limit != null && limit > 0 ? limit : total;
  if (denominator <= 0) return 0;
  return Math.max(0, Math.min(100, (part / denominator) * 100));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "27 Jul" — fixed English month names for the same hydration reason as
 *  `formatCount`. UTC-based so a server in one zone and a browser in another
 *  agree on which day a timestamp belongs to. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "1 Aug" for the credit-reset line. */
export function formatResetDate(iso: string | null | undefined): string {
  return formatDay(iso);
}

/** `usage_events.event_type` → what the user did. The activity log shows one
 *  line per job, so these read as actions, not as event names. */
const EVENT_LABELS: Record<string, string> = {
  image_analyzed: "Analyze",
  caption_generated: "Captions",
  export: "Export",
  search_query: "Search",
  asset_ingested: "Import",
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

/** `files.origin` → the source name the rest of the UI uses. */
const SOURCE_LABELS: Record<string, string> = {
  upload: "Uploads",
  gdrive: "Google Drive",
  dropbox: "Dropbox",
};

export function sourceLabel(origin: string): string {
  return SOURCE_LABELS[origin] ?? origin;
}

/** The right-hand column of an activity row: units for AI work, bytes for the
 *  things measured in bytes. Returns null when neither is meaningful. */
export function activityAmount(type: string, units: number, bytes: number): string | null {
  if (type === "asset_ingested") return bytes > 0 ? formatBytes(bytes) : `${formatCount(units)} files`;
  if (type === "export") return `${formatCount(units)} items · ${formatBytes(bytes)}`;
  if (type === "search_query") return `${formatCount(units)} searches`;
  if (units <= 0) return null;
  return `${formatCount(units)} cr`;
}
