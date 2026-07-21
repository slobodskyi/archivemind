/** First-party copy for every failure the Google Drive connect flow can
 *  surface. Same contract as lib/auth-errors.ts (ADR 0021, extended to this
 *  surface by ADR 0025): codes cross the wire, copy is authored here, and
 *  Google's own error text is never rendered — it is attacker-adjacent input
 *  (popup callbacks, token-endpoint bodies) wearing our domain's voice.
 *
 *  Null-prototype: codes arrive from JSON responses and GIS callbacks, so a
 *  plain object literal would resolve inherited keys (`constructor`, …). */

const GENERIC = "Couldn't connect Google Drive. Please try again.";

const MESSAGES: Record<string, string> = Object.assign(Object.create(null), {
  // User-side outcomes of the popup.
  drive_access_denied: "Connection cancelled.",
  drive_popup_closed: "The Google window was closed before finishing. Try again.",
  drive_popup_blocked:
    "Your browser blocked the Google popup. Allow popups for this site and try again.",
  // (a cookies-blocked code joins with the Picker in the imports PR — the
  // Picker iframe is the surface that actually needs the third-party cookie)
  // Workspace tenants where an admin gates third-party apps (our NGO/media
  // audience disproportionately lives there).
  drive_admin_blocked:
    "Your Google Workspace admin hasn't allowed ArchiveMind yet. Ask them to allow it, or connect a personal account.",
  // Granular consent: the user approved sign-in but unticked Drive access.
  drive_scope_missing:
    "Google Drive access wasn't granted. Tick the Drive permission on Google's screen and try again.",
  // Self-healing re-consent loop (see google-tokens.server.ts): we revoked a
  // refresh-token-less grant so the next attempt shows the full consent screen.
  drive_reconsent_required: "Google needs you to approve access once more. Click Connect again.",
  // Picker/import surface.
  drive_picker_failed: "Couldn't open the Google Drive picker. Reload and try again.",
  import_backlog: "Imports are queued up — wait for the current ones to finish, then retry.",
  drive_import_failed: "Some files couldn't be submitted. Try again.",
  // Server-side exchange failures.
  drive_code_invalid: "That connection attempt expired. Try again.",
  drive_connection_revoked:
    "Google Drive access was revoked. Reconnect it in Data sources and try again.",
  drive_not_connected: "Google Drive isn't connected yet.",
  drive_disconnect_failed: "Couldn't disconnect Google Drive. Please try again.",
  drive_connect_failed: GENERIC,
});

/** Always returns renderable first-party copy — unknown/missing codes get the
 *  generic sentence rather than leaking whatever string arrived. */
export function driveErrorMessage(code: unknown): string {
  if (typeof code !== "string") return GENERIC;
  return MESSAGES[code] ?? GENERIC;
}
