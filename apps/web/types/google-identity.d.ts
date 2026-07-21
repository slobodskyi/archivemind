/** Minimal hand-rolled types for the slice of Google Identity Services the
 *  Drive connect flow uses (loaded from accounts.google.com/gsi/client at
 *  runtime — no npm package involved). Extend when the Picker lands (PR 5). */

interface GsiCodeResponse {
  code?: string;
  error?: string;
  error_description?: string;
}

interface GsiClientError {
  type: "popup_closed" | "popup_failed_to_open" | "unknown" | string;
}

interface GsiCodeClient {
  requestCode(): void;
}

interface GsiCodeClientConfig {
  client_id: string;
  scope: string;
  ux_mode: "popup" | "redirect";
  callback: (response: GsiCodeResponse) => void;
  error_callback?: (error: GsiClientError) => void;
}

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initCodeClient(config: GsiCodeClientConfig): GsiCodeClient;
      };
    };
  };
}
