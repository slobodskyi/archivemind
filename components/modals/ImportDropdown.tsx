interface ImportDropdownProps {
  open: boolean;
  at: "rail" | "toolbar";
  onUpload: () => void;
}

function UploadIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14l4-7h8l4 7" />
      <path d="M4 14l4 5h8l4-5" />
      <path d="M8 14h8" />
    </svg>
  );
}

function DropboxIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3l5 3-5 3-5-3z" />
      <path d="M17 3l5 3-5 3-5-3z" />
      <path d="M2 12l5 3 5-3" />
      <path d="M12 12l5 3 5-3" />
      <path d="M7 18l5 3 5-3" />
    </svg>
  );
}

export default function ImportDropdown({ open, at, onUpload }: ImportDropdownProps) {
  if (!open) return null;
  const position: React.CSSProperties =
    at === "rail"
      ? { left: 74, top: 70, bottom: "auto" }
      : { left: "50%", bottom: 140, top: "auto", transform: "translateX(-50%)" };

  return (
    <div
      style={{
        position: "absolute",
        width: 268,
        background: "rgba(26,26,26,0.92)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 12,
        backdropFilter: "blur(16px)",
        boxShadow: "0 16px 48px rgba(0,0,0,.6)",
        zIndex: 55,
        padding: 7,
        ...position,
      }}
    >
      <button
        onClick={onUpload}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "1px dashed var(--border-hover)",
          borderRadius: 9,
          padding: "14px 12px",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)", fontSize: 13 }}>
          <UploadIcon />
          Upload files
        </span>
        <span style={{ fontSize: 11, color: "var(--text-tertiary)", paddingLeft: 23 }}>Drag photos here</span>
      </button>
      <button
        onClick={onUpload}
        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", background: "transparent", border: 0, borderRadius: 9, padding: "10px 11px", cursor: "pointer", fontFamily: "inherit", marginTop: 4 }}
      >
        <span style={{ display: "flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
          <DriveIcon />
        </span>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Connect Google Drive</span>
          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Pick specific files</span>
        </span>
      </button>
      <button
        onClick={onUpload}
        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", background: "transparent", border: 0, borderRadius: 9, padding: "10px 11px", cursor: "pointer", fontFamily: "inherit" }}
      >
        <span style={{ display: "flex", width: 28, height: 28, alignItems: "center", justifyContent: "center", borderRadius: 6, background: "var(--bg-elevated)", color: "var(--text-secondary)" }}>
          <DropboxIcon />
        </span>
        <span style={{ fontSize: 13, color: "var(--text-primary)" }}>Connect Dropbox</span>
      </button>
    </div>
  );
}
