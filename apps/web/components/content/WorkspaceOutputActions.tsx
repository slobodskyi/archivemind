interface WorkspaceOutputActionsProps {
  draftCount: number;
  photoCount: number;
  selectedCount: number;
  onOpen: () => void;
}

/** A Workspace's one outcome action (ADR 0045 as amended twice): one, not two.
 *
 *  It was three (Create / Drafts / Download), then two — and the pair still
 *  split one question, "what comes out of this Workspace", across two buttons
 *  whose answers differed only in whether the result stays editable. Download's
 *  own dialog opened on a Format row anyway, so folding it into the hub does
 *  not bury it: it promotes that row one level, where a format can carry a name
 *  and a sentence instead of being a bare chip. Only the default PDF costs an
 *  extra click; CSV and ZIP cost exactly what they did.
 *
 *  The badge is the draft count, so the button says whether there is unfinished
 *  work behind it without opening. */
export default function WorkspaceOutputActions({
  draftCount,
  photoCount,
  selectedCount,
  onOpen,
}: WorkspaceOutputActionsProps) {
  const sourceCount = selectedCount || photoCount;
  const live = sourceCount > 0 || draftCount > 0;
  return (
    <button
      onClick={onOpen}
      disabled={!live}
      aria-label={`Create or download${draftCount ? `, ${draftCount} draft${draftCount === 1 ? "" : "s"}` : ""}`}
      title={
        selectedCount
          ? `Create or download · ${selectedCount} selected`
          : `Create or download · ${photoCount} ${photoCount === 1 ? "file" : "files"}`
      }
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        minWidth: 112,
        boxSizing: "border-box",
        height: 30,
        borderRadius: 2,
        padding: "0 10px",
        background: live ? "var(--ac)" : "var(--bd)",
        border: 0,
        color: live ? "#050505" : "var(--tm)",
        fontFamily: "inherit",
        fontSize: 11.5,
        fontWeight: 800,
        letterSpacing: ".04em",
        cursor: live ? "pointer" : "default",
      }}
    >
      CREATE
      {draftCount > 0 && (
        <span style={{ padding: "1px 5px", background: "rgba(5,5,5,.18)", borderRadius: 2, fontSize: 9.5, fontWeight: 800 }}>
          {draftCount}
        </span>
      )}
    </button>
  );
}
