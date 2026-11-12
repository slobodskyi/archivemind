"use client";

import { useCallback, useEffect, useState } from "react";
import { boardShareCountsResponseSchema, type BoardShareCounts } from "@/lib/project-shares";

const NONE: BoardShareCounts = {};

/** Live links per Workspace (ADR 0053 §6), for the chip marker that says a
 *  Workspace is reachable from outside. Read after mount rather than in the
 *  first paint: the marker is a secondary signal, and a project whose links
 *  cannot be counted (an old database, a failed RPC) still has its chips —
 *  just unmarked, the hub card's own degradation. `refresh` is for whatever
 *  makes or turns off a link; `refreshKey` re-reads when the set of live
 *  Workspaces changes, since a trashed one's links pause and a restored
 *  one's resume. */
export function useBoardShareCounts(projectId: string | null, refreshKey: string): { counts: BoardShareCounts; refresh: () => void } {
  const [counts, setCounts] = useState<BoardShareCounts>(NONE);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/board-shares`, { cache: "no-store" });
        if (!response.ok) return;
        const body = boardShareCountsResponseSchema.safeParse(await response.json());
        if (live && body.success) setCounts(body.data.counts);
      } catch {
        // Unmarked chips are the honest fallback.
      }
    })();
    return () => {
      live = false;
    };
  }, [projectId, refreshKey, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { counts: projectId ? counts : NONE, refresh };
}
