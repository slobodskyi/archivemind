import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";
import { CloseIcon, GDriveIcon, DropboxIcon } from "@/components/icons/icons";

export interface GdriveConnectionState {
  connected: boolean;
  email: string | null;
  busy: boolean;
}

interface DataSourcesModalProps {
  open: boolean;
  onClose: () => void;
  /** Dropbox only (points at Add files — Chooser needs no connection); gdrive has its own handlers. */
  onConnect: (name: string) => void;
  gdrive: GdriveConnectionState;
  onGdriveConnect: () => void;
  onGdriveDisconnect: () => void;
}

const CONNECTABLE = [
  { key: "gdrive", label: "Google Drive", desc: "Import photos from your Drive.", Icon: GDriveIcon },
  { key: "dropbox", label: "Dropbox", desc: "No account link needed — pick files in Add files.", Icon: DropboxIcon },
] as const;

export default function DataSourcesModal({
  open,
  onClose,
  onConnect,
  gdrive,
  onGdriveConnect,
  onGdriveDisconnect,
}: DataSourcesModalProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: MODAL_BACKDROP,
        backdropFilter: MODAL_BLUR,
        zIndex: Z.modal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, background: "var(--bg-sf)", border: "1px solid var(--bdh)", borderRadius: 2, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 20px 15px", borderBottom: "1px solid var(--bd)" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)" }}>Connect a data source</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t2b)", cursor: "pointer" }}
          >
            <CloseIcon />
          </button>
        </div>
        <div style={{ padding: "16px 20px 20px" }}>
          {CONNECTABLE.map(({ key, label, desc, Icon }) => {
            const isGdrive = key === "gdrive";
            const connected = isGdrive && gdrive.connected;
            const busy = isGdrive && gdrive.busy;
            return (
              <div
                key={key}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: "1px solid var(--bd)" }}
              >
                <span style={{ display: "flex", width: 32, height: 32, flex: "0 0 auto", alignItems: "center", justifyContent: "center", borderRadius: 2, background: "var(--bg-el)" }}>
                  <Icon />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)" }}>{label}</div>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: connected ? "var(--ac)" : "var(--tm)",
                      marginTop: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {connected ? `Connected${gdrive.email ? ` as ${gdrive.email}` : ""}` : desc}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!isGdrive) return onConnect(label);
                    if (busy) return;
                    if (connected) onGdriveDisconnect();
                    else onGdriveConnect();
                  }}
                  disabled={busy}
                  style={{
                    flex: "0 0 auto",
                    height: 28,
                    padding: "0 12px",
                    background: "var(--bg-el)",
                    border: "1px solid var(--bdh)",
                    borderRadius: 2,
                    color: connected ? "var(--t2b)" : "var(--t1)",
                    fontSize: 11.5,
                    fontWeight: 700,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    fontFamily: "inherit",
                  }}
                >
                  {busy ? "…" : connected ? "Disconnect" : "Connect"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
