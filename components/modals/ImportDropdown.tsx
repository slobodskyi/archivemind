interface ImportDropdownProps {
  open: boolean;
  onUpload: () => void;
}

function UploadIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function DriveIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 14l4-7h8l4 7" />
      <path d="M4 14l4 5h8l4-5" />
      <path d="M8 14h8" />
    </svg>
  );
}

function DropboxIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 3l5 3-5 3-5-3z" />
      <path d="M17 3l5 3-5 3-5-3z" />
      <path d="M2 12l5 3 5-3" />
      <path d="M12 12l5 3 5-3" />
      <path d="M7 18l5 3 5-3" />
    </svg>
  );
}

export default function ImportDropdown({ open, onUpload }: ImportDropdownProps) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        bottom: 140,
        transform: "translateX(-50%)",
        width: 260,
        background: "rgba(20,20,20,.94)",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        backdropFilter: "blur(16px)",
        boxShadow: "0 16px 48px rgba(0,0,0,.6)",
        zIndex: 55,
        padding: 6,
      }}
    >
      <button
        onClick={onUpload}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "1px dashed var(--bdh)",
          borderRadius: 2,
          padding: "13px 11px",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--t1)", fontSize: 13 }}>
          <UploadIcon />
          Upload files
        </span>
        <span style={{ fontSize: 11, color: "var(--t3)", paddingLeft: 21 }}>Drag photos here</span>
      </button>
      <button
        onClick={onUpload}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "transparent", border: 0, borderRadius: 2, padding: "9px 10px", cursor: "pointer", fontFamily: "inherit", marginTop: 3 }}
      >
        <span style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 2, background: "var(--bg-el)", color: "var(--t2)" }}>
          <DriveIcon />
        </span>
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 13, color: "var(--t1)" }}>Google Drive</span>
          <span style={{ fontSize: 10.5, color: "var(--t3)" }}>Pick specific files</span>
        </span>
      </button>
      <button
        onClick={onUpload}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "transparent", border: 0, borderRadius: 2, padding: "9px 10px", cursor: "pointer", fontFamily: "inherit" }}
      >
        <span style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", borderRadius: 2, background: "var(--bg-el)", color: "var(--t2)" }}>
          <DropboxIcon />
        </span>
        <span style={{ fontSize: 13, color: "var(--t1)" }}>Dropbox</span>
      </button>
    </div>
  );
}
