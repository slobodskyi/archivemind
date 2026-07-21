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

interface GsiTokenResponse {
  access_token?: string;
  error?: string;
}

interface GsiTokenClient {
  requestAccessToken(): void;
}

interface GsiTokenClientConfig {
  client_id: string;
  scope: string;
  prompt: "" | "consent" | "select_account";
  callback: (response: GsiTokenResponse) => void;
  error_callback?: (error: GsiClientError) => void;
}

/** Minimal slice of the Google Picker namespace the import flow uses
 *  (loaded via gapi.load("picker") from apis.google.com/js/api.js). */
declare namespace google.picker {
  enum Action {
    PICKED = "picked",
    CANCEL = "cancel",
  }
  enum DocsViewMode {
    GRID = "grid",
    LIST = "list",
  }
  enum Feature {
    MULTISELECT_ENABLED = "multiselectEnabled",
  }
  interface DocumentObject {
    id: string;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
  }
  interface ResponseObject {
    action: string;
    docs?: DocumentObject[];
  }
  class DocsView {
    constructor(viewId?: unknown);
    setMimeTypes(mimeTypes: string): DocsView;
    setMode(mode: DocsViewMode): DocsView;
    setIncludeFolders(included: boolean): DocsView;
  }
  class Picker {
    setVisible(visible: boolean): void;
    dispose(): void;
  }
  class PickerBuilder {
    addView(view: DocsView): PickerBuilder;
    setAppId(appId: string): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    enableFeature(feature: Feature): PickerBuilder;
    setCallback(cb: (response: ResponseObject) => void): PickerBuilder;
    build(): Picker;
  }
}

interface Window {
  google?: {
    accounts: {
      oauth2: {
        initCodeClient(config: GsiCodeClientConfig): GsiCodeClient;
        initTokenClient(config: GsiTokenClientConfig): GsiTokenClient;
      };
    };
    /** present once gapi.load("picker") completes */
    picker?: typeof google.picker;
  };
  gapi?: {
    load(name: "picker", callback: () => void): void;
  };
}
