"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TRASH_EXPIRING_SOON_DAYS,
  type TrashFilterKey,
  type TrashItem,
  type TrashResponse,
  type TrashSort,
  type TrashTarget,
} from "@archivemind/shared";
import { trashItemKey } from "@/lib/trash-view";

export type TrashMode = "grid" | "list";

interface UseTrashOptions {
  /** Don't fetch until the surface is actually on screen. */
  active: boolean;
  /** Scopes the project-scoped kinds for the in-canvas panel. */
  projectId?: string | null;
  /** Kinds this surface is allowed to show at all — the panel excludes
   *  Workspaces because the header's own board state already owns them. */
  allow?: readonly TrashFilterKey[];
  onToast: (text: string, action?: { label: string; run: () => void }) => void;
  /** Fired after a restore lands, so a canvas can bring the rows back. */
  onRestored?: () => void;
}

const EMPTY: TrashResponse = {
  items: [],
  total: 0,
  totalBytes: 0,
  oldestExpiresAt: null,
  counts: {},
  expiringSoon: 0,
  retentionDays: 30,
};

const PAGE = 60;

/** Everything the Trash surfaces share (ADR 0049): the query, the page, the
 *  selection, and the two verbs. Both the homepage view and the in-canvas panel
 *  mount this, so "restore" means one thing and the filters behave identically
 *  in both places.
 *
 *  The filter lives here rather than in the list because it is a SERVER filter:
 *  a Trash can be far longer than one page, so narrowing in the browser would
 *  narrow the page and lie about the total — and the total is what the
 *  destructive button quotes. */
export function useTrash({ active, projectId, allow, onToast, onRestored }: UseTrashOptions) {
  const [types, setTypes] = useState<TrashFilterKey[]>([]);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<TrashSort>("recent");
  const [expiringOnly, setExpiringOnly] = useState(false);
  const [mode, setMode] = useState<TrashMode>("grid");

  const [data, setData] = useState<TrashResponse | null>(null);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Bumped to force a refetch after a write. */
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const buildUrl = useCallback(
    (offset: number) => {
      const params = new URLSearchParams();
      const effective = types.length > 0 ? types : (allow ?? []);
      for (const type of effective) params.append("type", type);
      if (projectId) params.set("project", projectId);
      if (debounced.trim()) params.set("q", debounced.trim());
      params.set("sort", sort);
      if (expiringOnly) params.set("expiring", String(TRASH_EXPIRING_SOON_DAYS));
      params.set("limit", String(PAGE));
      params.set("offset", String(offset));
      return `/api/trash?${params.toString()}`;
    },
    [types, allow, projectId, debounced, sort, expiringOnly],
  );

  useEffect(() => {
    if (!active) return;
    const id = ++requestId.current;
    fetch(buildUrl(0))
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error(String(resp.status)))))
      .then((body: TrashResponse) => {
        if (id !== requestId.current) return; // a newer filter already won
        setData(body);
        setItems(body.items);
      })
      .catch(() => {
        if (id !== requestId.current) return;
        setData(EMPTY);
        setItems([]);
      });
  }, [active, buildUrl, nonce]);

  /** Only the FIRST load is a loading state. A refilter swaps the rows under
   *  the same header rather than blanking the surface, which is what keeps the
   *  chips from flickering as you narrow. */
  const loading = data === null;

  // A filter change can hide what was selected, and acting on invisible rows is
  // the behaviour ADR 0040 already ruled out for the label filter — so the
  // selection is intersected with what is on screen at read time rather than
  // pruned in an effect.
  const visibleKeys = useMemo(() => new Set(items.map(trashItemKey)), [items]);
  const visibleSelection = useMemo(
    () => new Set([...selected].filter((key) => visibleKeys.has(key))),
    [selected, visibleKeys],
  );

  const loadMore = useCallback(() => {
    if (!data || items.length >= data.total || loadingMore) return;
    setLoadingMore(true);
    fetch(buildUrl(items.length))
      .then((resp) => (resp.ok ? resp.json() : Promise.reject(new Error(String(resp.status)))))
      .then((body: TrashResponse) => setItems((prev) => [...prev, ...body.items]))
      .catch(() => onToast("Could not load more"))
      .finally(() => setLoadingMore(false));
  }, [buildUrl, data, items.length, loadingMore, onToast]);

  const toggleType = useCallback((key: TrashFilterKey) => {
    setTypes((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  }, []);

  const clearFilters = useCallback(() => {
    setTypes([]);
    setQuery("");
    setExpiringOnly(false);
  }, []);

  const toggleSelect = useCallback((item: TrashItem) => {
    const key = trashItemKey(item);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelected(new Set()), []);
  const selectAll = useCallback(() => setSelected(new Set(items.map(trashItemKey))), [items]);

  const selectedTargets = useMemo<TrashTarget[]>(
    () =>
      items
        .filter((item) => visibleSelection.has(trashItemKey(item)))
        .map(({ kind, id }) => ({ kind, id })),
    [items, visibleSelection],
  );

  const send = useCallback(
    async (path: "restore" | "purge" | "delete", targets: TrashTarget[]) => {
      const resp = await fetch(`/api/trash/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: targets }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      return (await resp.json()) as { done: TrashTarget[]; failed: TrashTarget[] };
    },
    [],
  );

  /** Optimistic removal from the list. The refetch that follows is what makes
   *  it true; this only keeps the row from sitting there after the click. */
  const drop = useCallback((targets: TrashTarget[]) => {
    const gone = new Set(targets.map(trashItemKey));
    setItems((prev) => prev.filter((item) => !gone.has(trashItemKey(item))));
    setData((prev) => (prev ? { ...prev, total: Math.max(0, prev.total - targets.length) } : prev));
  }, []);

  const restore = useCallback(
    (targets: TrashTarget[]) => {
      if (targets.length === 0) return;
      drop(targets);
      setSelected(new Set());
      void send("restore", targets)
        .then(({ done }) => {
          onRestored?.();
          setNonce((n) => n + 1);
          onToast(done.length === 1 ? "1 item restored" : `${done.length} items restored`, {
            // Undo of a restore is a soft delete — back to the Trash, not out
            // of existence. The delete has offered an undo since ADR 0033; the
            // restore never did, and putting 200 photos back by hand is the
            // reason people distrust a Restore All button.
            label: "Undo",
            run: () => {
              void send("delete", done)
                .then(() => {
                  onRestored?.();
                  setNonce((n) => n + 1);
                })
                .catch(() => onToast("Could not undo — try again"));
            },
          });
        })
        .catch(() => {
          onToast("Could not restore — try again");
          setNonce((n) => n + 1);
        });
    },
    [drop, send, onToast, onRestored],
  );

  const purge = useCallback(
    (targets: TrashTarget[]) => {
      if (targets.length === 0) return;
      drop(targets);
      setSelected(new Set());
      void send("purge", targets)
        .then(({ done }) => {
          onToast(
            done.length === 1
              ? "1 item deleted permanently"
              : `${done.length} items deleted permanently`,
          );
          setNonce((n) => n + 1);
        })
        .catch(() => {
          onToast("Could not delete — try again");
          setNonce((n) => n + 1);
        });
    },
    [drop, send, onToast],
  );

  /** Every target the CURRENT filter matches, not just the loaded page — what
   *  "Delete all (N)" has to act on for its own number to be true. Capped at the
   *  500 every bulk endpoint takes; the caller reports the real count it got. */
  const collectTargets = useCallback(async (): Promise<TrashTarget[]> => {
    const url = buildUrl(0).replace(/limit=\d+/, "limit=200");
    const all: TrashTarget[] = [];
    for (let offset = 0; offset < 500; offset += 200) {
      const resp = await fetch(url.replace(/offset=\d+/, `offset=${offset}`));
      if (!resp.ok) break;
      const body = (await resp.json()) as TrashResponse;
      all.push(...body.items.map(({ kind, id }) => ({ kind, id })));
      if (all.length >= body.total) break;
    }
    return all.slice(0, 500);
  }, [buildUrl]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const filtered = types.length > 0 || debounced.trim().length > 0 || expiringOnly;

  return {
    items,
    total: data?.total ?? 0,
    totalBytes: data?.totalBytes ?? 0,
    counts: data?.counts ?? {},
    oldestExpiresAt: data?.oldestExpiresAt ?? null,
    expiringSoon: data?.expiringSoon ?? 0,
    loading,
    loadingMore,
    hasMore: !!data && items.length < data.total,
    loadMore,
    types,
    toggleType,
    query,
    setQuery,
    sort,
    setSort,
    expiringOnly,
    setExpiringOnly,
    mode,
    setMode,
    filtered,
    clearFilters,
    selected: visibleSelection,
    selectedTargets,
    toggleSelect,
    clearSelection,
    selectAll,
    restore,
    purge,
    collectTargets,
    refresh,
  };
}
