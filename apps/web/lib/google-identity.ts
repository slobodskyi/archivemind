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

const GAPI_SRC = "https://apis.google.com/js/api.js";
const PICKER_SCOPE = "https://www.googleapis.com/auth/drive.file";

let gapiPickerPromise: Promise<void> | null = null;

/** Load gapi + the Picker module (idempotent). */
function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (!gapiPickerPromise) {
    gapiPickerPromise = new Promise<void>((resolve, reject) => {
      const ready = () => {
        if (!window.gapi) return reject(new DriveAuthError("drive_picker_failed"));
        window.gapi.load("picker", () => resolve());
      };
      if (window.gapi) return ready();
      const script = document.createElement("script");
      script.src = GAPI_SRC;
      script.async = true;
      script.onload = ready;
      script.onerror = () => {
        gapiPickerPromise = null;
        reject(new DriveAuthError("drive_picker_failed"));
      };
      document.head.appendChild(script);
    });
  }
  return gapiPickerPromise;
}

/** Short-lived browser token for the Picker itself. The grant already exists
 *  (connect flow), so prompt:'' keeps this silent — the stored server-side
 *  tokens NEVER travel to the browser; this token is the browser's own and is
 *  never stored (ADR 0025). */
export async function requestPickerToken(loginHint?: string): Promise<string> {
  await loadGsi();
  const oauth2 = window.google?.accounts?.oauth2;
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!oauth2 || !clientId) throw new DriveAuthError("drive_connect_failed");
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: PICKER_SCOPE,
      prompt: "",
      // The connected account is known — hint it so a multi-account browser
      // session doesn't show the account chooser on every single pick.
      ...(loginHint ? { login_hint: loginHint } : {}),
      callback: (response) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new DriveAuthError(mapGsiError(response.error)));
      },
      error_callback: (error) => reject(new DriveAuthError(mapGsiError(error?.type))),
    });
    client.requestAccessToken();
  });
}

export interface PickedDriveFile {
  fileId: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

/** Open the Picker (LIST mode — thumbnails are unavailable under drive.file;
 *  multiselect; images only) and resolve with the picked files (empty array =
 *  user cancelled). setAppId MUST be the Cloud project NUMBER or every later
 *  backend read 404s — the day-1 spike's negative control. */
export async function openDrivePicker(pickerToken: string): Promise<PickedDriveFile[]> {
  await loadPicker();
  const pickerNs = window.google?.picker;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PICKER_API_KEY;
  const projectNumber = process.env.NEXT_PUBLIC_GOOGLE_PROJECT_NUMBER;
  if (!pickerNs || !apiKey || !projectNumber) throw new DriveAuthError("drive_picker_failed");

  return new Promise<PickedDriveFile[]>((resolve) => {
    const view = new pickerNs.DocsView()
      .setMimeTypes(
        "image/jpeg,image/png,image/heic,image/heif,image/tiff,image/webp,image/avif,image/gif",
      )
      .setMode(pickerNs.DocsViewMode.LIST);
    const picker = new pickerNs.PickerBuilder()
      .addView(view)
      .setAppId(projectNumber)
      .setOAuthToken(pickerToken)
      .setDeveloperKey(apiKey)
      .enableFeature(pickerNs.Feature.MULTISELECT_ENABLED)
      .setCallback((response) => {
        if (response.action === pickerNs.Action.PICKED) {
          const docs = response.docs ?? [];
          resolve(
            docs
              .filter((d) => typeof d.id === "string" && d.id.length > 0)
              .map((d) => ({
                fileId: d.id,
                name: d.name || d.id,
                mimeType: d.mimeType || "application/octet-stream",
                sizeBytes: typeof d.sizeBytes === "number" ? d.sizeBytes : undefined,
              })),
          );
          picker.dispose();
        } else if (response.action === pickerNs.Action.CANCEL) {
          resolve([]);
          picker.dispose();
        }
      })
      .build();
    picker.setVisible(true);
  });
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
