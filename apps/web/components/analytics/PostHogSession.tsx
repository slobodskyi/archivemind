"use client";

import { useEffect } from "react";
import { startAnalyticsSession } from "@/lib/analytics-client";

/** Mounted by every signed-in page and nowhere else — that placement IS the
 *  "signed-in only" rule of ADR 0050. Renders nothing. */
export default function PostHogSession({ userId, email }: { userId: string; email: string }) {
  useEffect(() => {
    void startAnalyticsSession({ id: userId, email });
  }, [userId, email]);
  return null;
}
