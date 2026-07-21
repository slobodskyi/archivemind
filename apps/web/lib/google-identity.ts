/** Client-side Google Identity Services loader + the Drive-connect code flow
 *  (ADR 0025). Popup mode only: the authorization code lands in a JS callback
 *  and goes to our authed /api/integrations/google/connect route — no public
 *  redirect callback exists anywhere in the app.
 *
 *  Every rejection is a DriveAuthError carrying a first-party code from
 *  lib/drive-errors.ts — GIS error strings are mapped, never surfaced. */

const GSI_SRC = "https://accounts.google.com/gsi/client";
/** openid+email ride along explicitly: the server's account-identity check
 *  (google-tokens.server.ts) needs the id_token email claim on EVERY grant —
 *  never rely on GIS adding those scopes implicitly. */
const CONNECT_SCOPES = "openid email https://www.googleapis.com/auth/drive.file";

export class DriveAuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "DriveAuthError";
  }
}

let gsiPromise: Promise<void> | null = null;

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        gsiPromise = null; // allow a retry after a transient network failure
        reject(new DriveAuthError("drive_connect_failed"));
      };
      document.head.appendChild(script);
    });
  }
  return gsiPromise;
}

/** GIS callback/error strings → first-party codes. Exported for tests. */
export function mapGsiError(error: string | undefined): string {
  switch (error) {
    case "access_denied":
      return "drive_access_denied";
    case "admin_policy_enforced":
      return "drive_admin_blocked";
    case "popup_closed":
      return "drive_popup_closed";
    case "popup_failed_to_open":
      return "drive_popup_blocked";
    default:
      return "drive_connect_failed";
  }
}

/** Open the Google consent popup and resolve with a one-time authorization
 *  code for the drive.file scope. Rejects with DriveAuthError only. */
export async function requestDriveCode(): Promise<string> {
  await loadGsi();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) throw new DriveAuthError("drive_connect_failed");
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new DriveAuthError("drive_connect_failed");

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initCodeClient({
      client_id: clientId,
      scope: CONNECT_SCOPES,
      ux_mode: "popup",
      callback: (response) => {
        if (response.code) resolve(response.code);
        else reject(new DriveAuthError(mapGsiError(response.error)));
      },
      error_callback: (error) => {
        reject(new DriveAuthError(mapGsiError(error?.type)));
      },
    });
    client.requestCode();
  });
}
