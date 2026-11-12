/** Presigned medium-preview URLs, remembered per tab (ADR 0054).
 *
 *  The asset list presigns thumbs only; the 1024 px medium is asked for when
 *  something needs it (`GET /api/assets/[id]/medium`). The drawer used to keep
 *  the answer in its own state, so the viewer opened from it would ask again,
 *  and stepping back to a photo asked a third time. One shared cache:
 *  - dedups a request already in flight (a prefetch racing the open);
 *  - keeps an answer for 20 minutes — the route signs into 30-minute buckets
 *    with an hour's validity, so a cached URL has at least 30 minutes left
 *    when it is issued and never reaches its expiry here;
 *  - keys on the photo's thumb PATH, which moves from `previews/` to `edits/`
 *    when an edit lands (ADR 0030), so a stale unedited URL is never reused.
 *  A null answer (previews not rendered yet) and a failed request are never
 *  cached: both are states that change on their own. */

import type { OriginalAnswer } from "@/lib/viewer-originals";

type Fetcher<T> = (id: string) => Promise<T | null>;

export interface UrlCache<T> {
  get(id: string, version: string): Promise<T | null>;
  /** The cached answer if one is fresh — lets a render skip the placeholder. */
  peek(id: string, version: string): T | undefined;
}
export type PreviewUrlCache = UrlCache<string>;

const DEFAULT_TTL_MS = 20 * 60_000;
/** A canvas holds at most 500 assets; past this the oldest answer goes. */
const MAX_ENTRIES = 600;

/** The cache over any per-asset answer that carries presigned URLs — the
 *  medium preview's bare URL, or the original route's `{ url, mime, bytes }`.
 *  A null answer and a failed request are never kept. */
export function createUrlCache<T>(
  fetcher: Fetcher<T>,
  now: () => number = Date.now,
  ttlMs: number = DEFAULT_TTL_MS,
): UrlCache<T> {
  const done = new Map<string, { url: T; at: number }>();
  const inflight = new Map<string, Promise<T | null>>();

  const fresh = (key: string): T | undefined => {
    const hit = done.get(key);
    if (!hit) return undefined;
    if (now() - hit.at < ttlMs) return hit.url;
    done.delete(key);
    return undefined;
  };

  return {
    peek(id, version) {
      return fresh(`${id}|${version}`);
    },
    get(id, version) {
      const key = `${id}|${version}`;
      const hit = fresh(key);
      if (hit) return Promise.resolve(hit);
      const pending = inflight.get(key);
      if (pending) return pending;
      const request = fetcher(id)
        .then((url) => {
          if (url) {
            done.set(key, { url, at: now() });
            if (done.size > MAX_ENTRIES) done.delete(done.keys().next().value as string);
          }
          return url;
        })
        .catch(() => null)
        .finally(() => inflight.delete(key));
      inflight.set(key, request);
      return request;
    },
  };
}

/** The version half of the key: the thumb's object path without its signature,
 *  which changes every half hour while the object stays the same. */
export function previewVersion(src: string | undefined): string {
  return (src ?? "").split("?")[0];
}

export function createPreviewUrlCache(
  fetcher: Fetcher<string>,
  now: () => number = Date.now,
  ttlMs: number = DEFAULT_TTL_MS,
): PreviewUrlCache {
  return createUrlCache<string>(fetcher, now, ttlMs);
}

export const mediumPreviewUrls = createPreviewUrlCache(async (id) => {
  const res = await fetch(`/api/assets/${id}/medium`);
  if (!res.ok) return null;
  const body = (await res.json()) as { url: string | null };
  return body.url ?? null;
});

/** The original route's answer (ADR 0054), version "" — an original does not
 *  change when an edit lands, only the previews do. "Not stored" and "format"
 *  are answers, cached like a URL: neither changes on its own. */
export const originalUrls = createUrlCache<OriginalAnswer>(async (id) => {
  const res = await fetch(`/api/assets/${id}/original`);
  if (!res.ok) return null;
  return (await res.json()) as OriginalAnswer;
});

/** The 2048 px preview's answer (ADR 0055): `{ url: null }` when the photo has
 *  nothing larger than its medium. Wrapped in an object so that "none" is
 *  cached for the TTL like a URL — it changes only when the worker's backfill
 *  reaches the photo, which a 20-minute-old answer can wait for. Keyed on the
 *  thumb path like the medium, so an edit landing asks again. */
export type LargeAnswer = { url: string | null };
export const largePreviewUrls = createUrlCache<LargeAnswer>(async (id) => {
  const res = await fetch(`/api/assets/${id}/medium?size=large`);
  if (!res.ok) return null;
  const body = (await res.json()) as { url?: string | null };
  return { url: body.url ?? null };
});
