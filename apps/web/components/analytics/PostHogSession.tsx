"use client";

import { useEffect } from "react";
import { startAnalyticsSession } from "@/lib/analytics-client";

/** Mounted by every signed-in page and nowhere else — that placement IS the
 *  "signed-in only" rule of ADR 0050. Renders nothing. */
export default function PostHogSession({
  userId,
  email,
  replayImageToken = null,
}: {
  userId: string;
  email: string;
  /** Lets replays show photos (lib/replay-image.ts); null = blank them. */
  replayImageToken?: string | null;
}) {
  useEffect(() => {
    void startAnalyticsSession({ id: userId, email }, replayImageToken);
  }, [userId, email, replayImageToken]);
  return null;
}
