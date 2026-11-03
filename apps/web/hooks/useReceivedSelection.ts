"use client";

import { useEffect } from "react";
import { receivedAssetsResponseSchema } from "@/lib/project-shares";

/** "Show on canvas" for a project share link (ADR 0051 §12): ask which files
 *  the link brought in that are still in the project, select them, then drop
 *  `?received=` from the address so a reload does not select them again.
 *  `select` is the canvas's own select-these-ids action, which keeps only the
 *  ids loaded on this canvas and toasts how many it found. */
export function useReceivedSelection(shareId: string | null, select: (ids: string[]) => void): void {
  useEffect(() => {
    if (!shareId) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/api/project-shares/${encodeURIComponent(shareId)}/received`, { cache: "no-store" });
        if (!response.ok) return;
        const body = receivedAssetsResponseSchema.safeParse(await response.json());
        if (live && body.success) select(body.data.assetIds);
      } catch {
        // Selection is a convenience: the canvas is already open either way.
      } finally {
        if (live) {
          const url = new URL(window.location.href);
          url.searchParams.delete("received");
          // Next integrates native history calls with its router.
          window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [shareId, select]);
}
