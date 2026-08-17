import { driveErrorMessage } from "@/lib/drive-errors";
import type { BrowseEntry } from "@/lib/onedrive";

/** The browser's half of GET /api/sources/onedrive/browse (ADR 0047 D1).
 *
 *  Deliberately React-free and outside the hook: it performs the request and
 *  RETURNS an outcome rather than writing state, so the effect that calls it
 *  updates state from a promise callback instead of synchronously
 *  (react-hooks/set-state-in-effect). Keeping it out of the hook is also what
 *  makes the cancellation in useOneDriveBrowse possible — the fetch knows
 *  nothing about whether anyone still wants the answer. */

export type BrowsePage =
  | { ok: true; items: BrowseEntry[]; driveId: string | null; nextSkipToken: string | null }
  | { ok: false; message: string };

export async function fetchBrowsePage(input: {
  itemId: string;
  driveId: string | null;
  skipToken: string | null;
  signal?: AbortSignal;
}): Promise<BrowsePage> {
  const q = new URLSearchParams({ itemId: input.itemId });
  if (input.driveId) q.set("driveId", input.driveId);
  if (input.skipToken) q.set("skipToken", input.skipToken);
  try {
    const res = await fetch(`/api/sources/onedrive/browse?${q}`, { signal: input.signal });
    const raw = (await res.json().catch(() => ({}))) as {
      items?: BrowseEntry[];
      driveId?: string | null;
      nextSkipToken?: string | null;
      error?: unknown;
    };
    if (!res.ok) return { ok: false, message: driveErrorMessage(raw.error) };
    return {
      ok: true,
      items: raw.items ?? [],
      driveId: raw.driveId ?? null,
      nextSkipToken: raw.nextSkipToken ?? null,
    };
  } catch {
    return { ok: false, message: driveErrorMessage("onedrive_browse_failed") };
  }
}
