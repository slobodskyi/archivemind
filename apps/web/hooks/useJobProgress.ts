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
}

/** Subscribes to the workspace's private Broadcast channel and calls
 *  `onUpdate` for every ai_jobs change (ADR 0009 — no postgres_changes).
 *  The callback ref pattern keeps one socket for the component's lifetime. */
export function useJobProgress(workspaceId: string, onUpdate: (job: JobUpdate) => void): void {
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
      if (cancelled) return;
      channel
        .on("broadcast", { event: "UPDATE" }, (msg) => {
          const record = (msg.payload as { record?: JobUpdate } | undefined)?.record;
          if (record?.id) cb.current(record);
        })
        .on("broadcast", { event: "INSERT" }, (msg) => {
          const record = (msg.payload as { record?: JobUpdate } | undefined)?.record;
          if (record?.id) cb.current(record);
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [workspaceId]);
}
