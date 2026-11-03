"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/** ai_jobs row fields the Broadcast trigger ships (migration 0001 →
 *  realtime.broadcast_changes on the private `workspace:<id>` topic). */
export interface JobUpdate {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  progress: number;
  progress_label: string | null;
  total_items: number | null;
  done_items: number | null;
  error: string | null;
  /** Who queued the job. The trigger broadcasts the whole row, so this is
   *  always present; null for a job nobody signed in queued — a project share
   *  link's ZIP or upload (ADR 0051). */
  user_id: string | null;
}

/** Subscribes to the workspace's private Broadcast channel and calls
 *  `onUpdate` for every ai_jobs change (ADR 0009 — no postgres_changes).
 *  `own` says whether the viewer queued it: the channel carries every job in
 *  the workspace — a teammate's, or a stranger's through a share link — and a
 *  toast addressed to "you" must only fire for the viewer's own.
 *  The callback ref pattern keeps one socket for the component's lifetime. */
export function useJobProgress(
  workspaceId: string,
  onUpdate: (job: JobUpdate, own: boolean) => void,
): void {
  const cb = useRef(onUpdate);
  useEffect(() => {
    cb.current = onUpdate;
  });

  useEffect(() => {
    if (!workspaceId) return;
    const supabase = createClient();
    const channel = supabase.channel(`workspace:${workspaceId}`, { config: { private: true } });

    let cancelled = false;
    (async () => {
      await supabase.realtime.setAuth(); // private channels require an authed socket
      const { data } = await supabase.auth.getClaims();
      const viewerId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
      if (cancelled) return;
      const deliver = (record: JobUpdate) =>
        cb.current(record, viewerId !== null && record.user_id === viewerId);
      channel
        .on("broadcast", { event: "UPDATE" }, (msg) => {
          const record = (msg.payload as { record?: JobUpdate } | undefined)?.record;
          if (record?.id) deliver(record);
        })
        .on("broadcast", { event: "INSERT" }, (msg) => {
          const record = (msg.payload as { record?: JobUpdate } | undefined)?.record;
          if (record?.id) deliver(record);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [workspaceId]);
}
