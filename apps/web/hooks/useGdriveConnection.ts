"use client";

import { useCallback, useState } from "react";
import { googleConnectionStatusSchema } from "@archivemind/shared";
import { DriveAuthError, requestDriveCode } from "@/lib/google-identity";
import { driveErrorMessage } from "@/lib/drive-errors";

/** The gdrive connection lifecycle, shared by DataSourcesModal (homepage) and
 *  the ImportModal's Drive pane (ADR 0025). All copy comes from
 *  lib/drive-errors.ts; `notify` is the host surface's toast. */

export interface GdriveConnectionState {
  connected: boolean;
  email: string | null;
  busy: boolean;
  /** true once the first status GET resolved (distinguish "unknown" from "no") */
  loaded: boolean;
  connectionId: string | null;
}

export function useGdriveConnection(notify: (text: string, kind?: "ok" | "error") => void) {
  const [gdrive, setGdrive] = useState<GdriveConnectionState>({
    connected: false,
    email: null,
    busy: false,
    loaded: false,
    connectionId: null,
  });

  const refresh = useCallback(async () => {
    const markLoaded = () => setGdrive((g) => (g.busy || g.loaded ? g : { ...g, loaded: true }));
    try {
      const res = await fetch("/api/integrations/google");
      if (!res.ok) return markLoaded();
      const parsed = googleConnectionStatusSchema.safeParse(await res.json());
      if (!parsed.success) return markLoaded();
      // busy-guard: a slow GET must never overwrite the outcome of a connect/
      // disconnect that finished while it was in flight.
      setGdrive((g) =>
        g.busy
          ? g
          : {
              ...g,
              connected: parsed.data.connected,
              email: parsed.data.email,
              loaded: true,
              connectionId: parsed.data.connectionId ?? null,
            },
      );
    } catch {
      // Status is cosmetic; connect/disconnect surface their own errors — but
      // the pane must leave "Checking…" even when this GET fails.
      markLoaded();
    }
  }, []);

  const connect = useCallback(async () => {
    setGdrive((g) => ({ ...g, busy: true }));
    try {
      const code = await requestDriveCode();
      const res = await fetch("/api/integrations/google/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const raw: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(driveErrorMessage((raw as { error?: unknown }).error));
        return false;
      }
      const parsed = googleConnectionStatusSchema.safeParse(raw);
      const email = parsed.success ? parsed.data.email : null;
      const connectionId = parsed.success ? (parsed.data.connectionId ?? null) : null;
      setGdrive((g) => ({ ...g, connected: true, email, loaded: true, connectionId }));
      notify(email ? `Google Drive connected as ${email}` : "Google Drive connected", "ok");
      return true;
    } catch (err) {
      notify(driveErrorMessage(err instanceof DriveAuthError ? err.code : undefined));
      return false;
    } finally {
      setGdrive((g) => ({ ...g, busy: false }));
    }
  }, [notify]);

  const disconnect = useCallback(async () => {
    setGdrive((g) => ({ ...g, busy: true }));
    try {
      const res = await fetch("/api/integrations/google", { method: "DELETE" });
      const raw: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify(driveErrorMessage((raw as { error?: unknown }).error ?? "drive_disconnect_failed"));
        return;
      }
      setGdrive((g) => ({ ...g, connected: false, email: null, connectionId: null }));
      notify("Google Drive disconnected", "ok");
    } catch {
      notify(driveErrorMessage("drive_disconnect_failed"));
    } finally {
      setGdrive((g) => ({ ...g, busy: false }));
    }
  }, [notify]);

  return { gdrive, refresh, connect, disconnect };
}
