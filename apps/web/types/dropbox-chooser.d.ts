/** Minimal types for the Dropbox Chooser drop-in (dropins.js, loaded with
 *  data-app-key at runtime — no npm package involved). ADR 0008 / #24. */

interface DropboxChooserFile {
  id: string;
  name: string;
  link: string;
  bytes: number;
  icon?: string;
  thumbnailLink?: string;
  isDir: boolean;
}

interface DropboxChooseOptions {
  success: (files: DropboxChooserFile[]) => void;
  cancel?: () => void;
  linkType: "preview" | "direct";
  multiselect?: boolean;
  extensions?: string[];
  folderselect?: boolean;
  sizeLimit?: number;
}

interface Window {
  Dropbox?: {
    choose(options: DropboxChooseOptions): void;
    isBrowserSupported(): boolean;
  };
}
