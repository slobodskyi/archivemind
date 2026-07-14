import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";
import { CloseIcon, GDriveIcon, DropboxIcon } from "@/components/icons/icons";

interface DataSourcesModalProps {
  open: boolean;
  onClose: () => void;
  onConnect: (name: string) => void;
}

const CONNECTABLE = [
  { key: "gdrive", label: "Google Drive", desc: "Import photos from your Drive folders.", Icon: GDriveIcon },
  { key: "dropbox", label: "Dropbox", desc: "Import photos from your Dropbox folders.", Icon: DropboxIcon },
] as const;

export default function DataSourcesModal({ open, onClose, onConnect }: DataSourcesModalProps) {
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
          {CONNECTABLE.map(({ key, label, desc, Icon }) => (
            <div
              key={key}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 4px", borderBottom: "1px solid var(--bd)" }}
            >
              <span style={{ display: "flex", width: 32, height: 32, flex: "0 0 auto", alignItems: "center", justifyContent: "center", borderRadius: 2, background: "var(--bg-el)" }}>
                <Icon />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)" }}>{label}</div>
                <div style={{ fontSize: 11.5, color: "var(--tm)", marginTop: 1 }}>{desc}</div>
              </div>
              <button
                onClick={() => onConnect(label)}
                style={{ flex: "0 0 auto", height: 28, padding: "0 12px", background: "var(--bg-el)", border: "1px solid var(--bdh)", borderRadius: 2, color: "var(--t1)", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
              >
                Connect
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
