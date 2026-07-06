import { CloseIcon } from "@/components/icons/icons";

interface PreviewItem {
  src: string;
  onClick: () => void;
}

interface PreviewModalProps {
  open: boolean;
  title: string;
  items: PreviewItem[];
  onClose: () => void;
}

export default function PreviewModal({ open, title, items, onClose }: PreviewModalProps) {
  if (!open) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        zIndex: 66,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxHeight: "70vh",
          background: "var(--bg-sf)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,.7)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid var(--bd)" }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)" }}>{title}</span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", border: 0, background: "var(--bg-el)", borderRadius: 2, color: "var(--t3)", cursor: "pointer" }}
          >
            <CloseIcon />
          </button>
        </div>
        <div style={{ padding: "16px 18px", overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
          {items.map((it, i) => (
            <div
              key={i}
              onClick={it.onClick}
              style={{
                aspectRatio: "1",
                borderRadius: 2,
                overflow: "hidden",
                border: "1px solid var(--bd)",
                backgroundImage: `url(${it.src})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
