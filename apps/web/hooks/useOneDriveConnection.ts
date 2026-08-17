"use client";

import { useCallback, useEffect, useState } from "react";
import { driveErrorMessage } from "@/lib/drive-errors";

/** The OneDrive connection lifecycle (ADR 0047), shaped like
 *  useGdriveConnection so the two panes read the same — with one structural
 *  difference: connecting is a full-page REDIRECT, not a popup.
 *
 *  That is forced by the app registration. A confidential `Web` client is what
 *  yields a refresh token that outlives a day (a `spa` redirect URI caps them
 *  at 24 h, which would strand the worker mid-import), and a Web redirect URI
 *  means a real redirect leg. So `connect()` navigates away and the answer
 *  arrives back as a query parameter, which `useOneDriveRedirectResult` picks
 *  up. */

export interface OneDriveConnectionState {
  connected: boolean;
  email: string | null;
  accountType: "personal" | "business" | null;
  busy: boolean;
  /** true once the first status GET resolved (distinguish "unknown" from "no") */
  loaded: boolean;
  connectionId: string | null;
}

const INITIAL: OneDriveConnectionState = {
  connected: false,
  email: null,
  accountType: null,
  busy: false,
  loaded: false,
  connectionId: null,
};

export function useOneDriveConnection(notify: (text: string, kind?: "ok" | "error") => void) {
  const [onedrive, setOnedrive] = useState<OneDriveConnectionState>(INITIAL);

  const refresh = useCallback(async () => {
    const markLoaded = () => setOnedrive((s) => (s.busy || s.loaded ? s : { ...s, loaded: true }));
    try {
      const res = await fetch("/api/sources/onedrive");
      if (!res.ok) return markLoaded();
      const raw = (await res.json()) as {
        connected?: unknown;
        email?: unknown;
        accountType?: unknown;
        connectionId?: unknown;
      };
      // busy-guard, same reason as gdrive: a slow GET must not overwrite the
      // outcome of a disconnect that finished while it was in flight.
      setOnedrive((s) =>
        s.busy
          ? s
          : {
              ...s,
              connected: raw.connected === true,
              email: typeof raw.email === "string" ? raw.email : null,
              accountType:
                raw.accountType === "personal" || raw.accountType === "business"
                  ? raw.accountType
                  : null,
              connectionId: typeof raw.connectionId === "string" ? raw.connectionId : null,
              loaded: true,
            },
      );
    } catch {
      markLoaded();
    }
  }, []);

  /** Leaves the app. Nothing after this call runs in this document. */
  const connect = useCallback(() => {
    const back = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/sources/onedrive/oauth?next=${encodeURIComponent(back)}`;
  }, []);

  const disconnect = useCallback(async () => {
    setOnedrive((s) => ({ ...s, busy: true }));
    try {
      const res = await fetch("/api/sources/onedrive", { method: "DELETE" });
      const raw: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(driveErrorMessage((raw as { error?: unknown }).error ?? "onedrive_disconnect_failed"));
        return;
      }
      setOnedrive((s) => ({ ...s, connected: false, email: null, accountType: null, connectionId: null }));
      // Deliberately not "disconnected" full stop: Microsoft has no
      // programmatic revocation, so the grant still stands on their side until
      // the user removes it. Claiming otherwise would be a lie about a
      // security action.
      notify("OneDrive disconnected here. Remove ArchiveMind in your Microsoft account to revoke it fully.", "ok");
    } catch {
      notify(driveErrorMessage("onedrive_disconnect_failed"));
    } finally {
      setOnedrive((s) => ({ ...s, busy: false }));
    }
  }, [notify]);

  return { onedrive, refresh, connect, disconnect };
}

/** Reads the `?onedrive=` / `?onedrive_error=` the callback redirect leaves
 *  behind, reports it, and strips it from the URL so a reload cannot re-fire
 *  the toast (or leave an error code sitting in a shared link). */
export function useOneDriveRedirectResult(
  notify: (text: string, kind?: "ok" | "error") => void,
  onConnected?: () => void,
) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const ok = url.searchParams.get("onedrive");
    const err = url.searchParams.get("onedrive_error");
    if (!ok && !err) return;

    url.searchParams.delete("onedrive");
    url.searchParams.delete("onedrive_error");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    if (err) notify(driveErrorMessage(err));
    else {
      notify("OneDrive connected", "ok");
      onConnected?.();
    }
    // Run once per mount: the URL is cleaned above, so re-running finds nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
