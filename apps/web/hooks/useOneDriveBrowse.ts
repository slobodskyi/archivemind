"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchBrowsePage } from "@/lib/onedrive-client";
import type { BrowseEntry } from "@/lib/onedrive";

/** Folder navigation + listing for the OneDrive browser (ADR 0047 D1).
 *
 *  A hook rather than component-local state for the same reason
 *  useGdriveConnection is one: cloud lifecycles live beside each other, and it
 *  keeps the component a pure rendering of what it is handed. */

export interface Crumb {
  itemId: string;
  name: string;
}

const ROOT: Crumb = { itemId: "root", name: "My files" };

export function useOneDriveBrowse() {
  const [crumbs, setCrumbs] = useState<Crumb[]>([ROOT]);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [nextSkipToken, setNextSkipToken] = useState<string | null>(null);
  /** Starts true — the first listing is already in flight from mount. */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A ref, not state: the drive id is never rendered, and keeping it out of
  // state is what stops the first response from changing the effect's inputs
  // and listing the root a second time.
  const driveIdRef = useRef<string | null>(null);

  const current = crumbs[crumbs.length - 1];
  const currentId = current.itemId;

  const apply = useCallback((page: Awaited<ReturnType<typeof fetchBrowsePage>>, append: boolean) => {
    if (!page.ok) {
      setError(page.message);
      setLoading(false);
      return;
    }
    if (page.driveId) driveIdRef.current = page.driveId;
    setEntries((prev) => (append ? [...prev, ...page.items] : page.items));
    setNextSkipToken(page.nextSkipToken);
    setLoading(false);
  }, []);

  useEffect(() => {
    // Cancellation matters here, not just tidiness: clicking quickly through
    // folders can otherwise land an older response after a newer one and show
    // the wrong folder's contents under the right breadcrumb.
    const controller = new AbortController();
    void fetchBrowsePage({
      itemId: currentId,
      driveId: driveIdRef.current,
      skipToken: null,
      signal: controller.signal,
    }).then((page) => {
      if (!controller.signal.aborted) apply(page, false);
    });
    return () => controller.abort();
  }, [currentId, apply]);

  /** Navigating is the event that starts a load, so it owns the transition —
   *  clearing the old rows too, or the previous folder's contents linger under
   *  the new breadcrumb while the fetch is in flight. */
  const navigate = useCallback((next: (c: Crumb[]) => Crumb[]) => {
    setLoading(true);
    setError(null);
    setEntries([]);
    setNextSkipToken(null);
    setCrumbs(next);
  }, []);

  const openFolder = useCallback(
    (e: BrowseEntry) => navigate((c) => [...c, { itemId: e.itemId, name: e.name }]),
    [navigate],
  );

  const goTo = useCallback((index: number) => navigate((c) => c.slice(0, index + 1)), [navigate]);

  const loadMore = useCallback(() => {
    if (!nextSkipToken) return;
    setLoading(true);
    void fetchBrowsePage({
      itemId: currentId,
      driveId: driveIdRef.current,
      skipToken: nextSkipToken,
    }).then((page) => apply(page, true));
  }, [apply, currentId, nextSkipToken]);

  return { crumbs, entries, loading, error, nextSkipToken, openFolder, goTo, loadMore };
}
