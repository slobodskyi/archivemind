"use client";

import type { PostHog } from "posthog-js";
import { POSTHOG_KEY, posthogConfig } from "@/lib/analytics";

/** Browser half of ADR 0050. posthog-js is imported on demand, so a page that
 *  never signs in (landing, login, `/p/*`) never downloads it. */

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

function load(): Promise<PostHog | null> {
  // No key = analytics off (local dev, tests, previews without the env var).
  if (!POSTHOG_KEY) return Promise.resolve(null);
  loading ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(POSTHOG_KEY, posthogConfig());
    client = posthog;
    return posthog;
  });
  return loading;
}

/** Start (or continue) the signed-in user's session. Id and email only — the
 *  email is there so a recording can be matched to a person from support. */
export async function startAnalyticsSession(user: { id: string; email: string }): Promise<void> {
  const posthog = await load();
  if (!posthog) return;
  // A different account in the same browser (sign-out skipped by a dead
  // session, or /auth/reset): never stitch two people into one person.
  const current = posthog.get_distinct_id();
  if (posthog.get_property("$user_state") === "identified" && current !== user.id) {
    posthog.reset();
  }
  posthog.identify(user.id, { email: user.email });
}

/** Sign-out: forget the identity so the next person on this browser starts
 *  clean. A no-op if PostHog never loaded on this page. */
export function resetAnalytics(): void {
  client?.reset();
}
