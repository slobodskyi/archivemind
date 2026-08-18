"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { useDialog } from "@/hooks/useDialog";
import { MODAL_BACKDROP, MODAL_BLUR, Z } from "@/lib/ui";
import {
  publicationLinkExpired,
  publicationShareDisplayStatus,
  type PublicationShareSummary,
} from "@/lib/publication-shares";

export type SharePreviewExpiryDays = 7 | 30 | null;

export interface SharePreviewOptions {
  expiresInDays: SharePreviewExpiryDays;
  allowDownloads: boolean;
}

export interface SharePreviewResult {
  shareId: string;
  url: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface SharePreviewDialogProps {
  open: boolean;
  draftName: string;
  draftKind: "article" | "instagram_carousel";
  busy: boolean;
  error: string | null;
  result: SharePreviewResult | null;
  resultOutdated?: boolean;
  /** The server no longer lists this version as live — revoked here or on
   *  another device, or invalidated because one of its photos left the archive.
   *  Expiry is caught by the dialog's own clock check. */
  resultEnded?: boolean;
  /** Live versions the server knows about whose URL this browser does not hold. */
  unmanagedShares?: readonly PublicationShareSummary[];
  onClose: () => void;
  onCreate: (options: SharePreviewOptions) => void;
  onRevoke: (shareId: string) => void;
  /** Forget a local record that no longer describes a usable link. */
  onDismissResult: () => void;
}

const buttonStyle: CSSProperties = {
  minHeight: 40,
  padding: "0 12px",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "transparent",
  color: "var(--t2)",
  fontFamily: "inherit",
  fontSize: 11,
  cursor: "pointer",
};

function expiryButtonStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    ...buttonStyle,
    minWidth: 0,
    flex: 1,
    background: active ? "var(--bg-el)" : "transparent",
    borderColor: active ? "var(--bdh)" : "var(--bd)",
    color: active ? "var(--t1)" : "var(--t2)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatExpiry(value: string | null): string {
  if (!value) return "Does not expire";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Expiry unavailable";
  return `Expires ${formatDay(value)}`;
}

function SharePreviewDialogContent({
  draftName,
  draftKind,
  busy,
  error,
  result,
  resultOutdated = false,
  resultEnded = false,
  unmanagedShares = [],
  onClose,
  onCreate,
  onRevoke,
  onDismissResult,
}: Omit<SharePreviewDialogProps, "open">) {
  const [expiresInDays, setExpiresInDays] = useState<SharePreviewExpiryDays>(30);
  const [allowDownloads, setAllowDownloads] = useState(true);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useDialog<HTMLDivElement>(true, busy ? () => {} : onClose);
  const keepLinkRef = useRef<HTMLButtonElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const expired = result ? publicationLinkExpired(result.expiresAt) : false;
  const ended = Boolean(result) && (expired || resultEnded);
  const resultId = result && !ended ? result.shareId : null;

  useEffect(() => {
    if (confirmingRevoke) keepLinkRef.current?.focus();
  }, [confirmingRevoke]);

  useEffect(() => {
    if (resultId) linkInputRef.current?.focus();
  }, [resultId]);

  const close = () => {
    if (!busy) onClose();
  };
  const copyLink = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: Z.modal,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: MODAL_BACKDROP,
        backdropFilter: MODAL_BLUR,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={busy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "min(520px, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 40px)",
          overflowY: "auto",
          background: "var(--bg-sf)",
          border: "1px solid var(--bdh)",
          borderRadius: 2,
          boxShadow: "0 32px 80px rgba(0,0,0,.7)",
        }}
      >
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, padding: "18px 18px 16px 20px", borderBottom: "1px solid var(--bd)" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: "var(--t3)", fontSize: 9, fontWeight: 800, letterSpacing: ".08em" }}>
              {draftKind === "article" ? "ARTICLE PREVIEW" : "CAROUSEL PREVIEW"}
            </div>
            <h2 id={titleId} style={{ margin: "5px 0 0", overflow: "hidden", color: "var(--t1)", fontSize: 16, fontWeight: 800, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Share “{draftName}”
            </h2>
            <p id={descriptionId} style={{ margin: "7px 0 0", color: "var(--t2)", fontSize: 11.5, lineHeight: 1.5 }}>
              Create a view-only preview link anyone can open — no ArchiveMind account needed.
            </p>
          </div>
          <button type="button" onClick={close} disabled={busy} aria-label="Close share preview" style={{ ...buttonStyle, width: 40, flex: "0 0 auto", padding: 0, fontSize: 17, opacity: busy ? 0.45 : 1 }}>×</button>
        </header>

        {unmanagedShares.length ? (
          <div style={{ padding: "16px 20px 0" }}>
            <div style={{ padding: "12px 13px", border: "1px solid rgba(255,184,77,.35)", background: "rgba(255,184,77,.06)", borderRadius: 2 }}>
              <div style={{ color: "#ffbd66", fontSize: 11, fontWeight: 700 }}>
                {unmanagedShares.length === 1 ? "A link for this draft is live elsewhere" : `${unmanagedShares.length} links for this draft are live elsewhere`}
              </div>
              <div style={{ marginTop: 5, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.5 }}>
                Its address isn’t stored in this browser and can’t be recovered — links are kept as a hash, never in full. You can still turn it off here.
              </div>
              {unmanagedShares.map((share) => (
                <div key={share.shareId} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--bd)" }}>
                  <span style={{ minWidth: 0, flex: 1, color: "var(--t2)", fontSize: 10.5 }}>
                    {publicationShareDisplayStatus(share) === "preparing" ? "Preparing" : "Live"} · Created {formatDay(share.createdAt)} · {formatExpiry(share.expiresAt).toLowerCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRevoke(share.shareId)}
                    disabled={busy}
                    style={{ ...buttonStyle, flex: "0 0 auto", minHeight: 36, borderColor: "transparent", color: "var(--red)", fontSize: 10.5, opacity: busy ? 0.5 : 1 }}
                  >
                    Turn off
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {result && ended ? (
          <div style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--t2)", fontSize: 11.5, fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", border: "1px solid var(--t3)" }} />
              {expired ? "Preview link has expired" : "Preview link is no longer live"}
            </div>
            <div style={{ marginTop: 6, color: "var(--t2)", fontSize: 10.5 }}>
              {expired
                ? `Expired ${formatDay(result.expiresAt ?? result.createdAt)}`
                : `Created ${formatDay(result.createdAt)}`}
            </div>

            <div style={{ marginTop: 12, padding: "12px 13px", background: "var(--bg-el)", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.55 }}>
              {expired
                ? "Anyone opening it now sees a “link not available” page. Create a new link to share your current draft."
                : "It was turned off, or one of its photos left the archive. Anyone opening it now sees a “link not available” page. Create a new link to share your current draft."}
            </div>

            {error ? <div role="alert" style={{ marginTop: 12, color: "var(--red)", fontSize: 11 }}>{error}</div> : null}

            <div style={{ display: "flex", gap: 7, marginTop: 18 }}>
              <button data-autofocus="" type="button" onClick={onDismissResult} disabled={busy} style={{ ...buttonStyle, flex: 1, background: "var(--ac)", border: 0, color: "#050505", fontWeight: 800, opacity: busy ? 0.55 : 1 }}>
                Create a new link
              </button>
              <button type="button" onClick={close} disabled={busy} style={{ ...buttonStyle, flex: 1, opacity: busy ? 0.5 : 1 }}>Close</button>
            </div>
          </div>
        ) : result ? (
          <div style={{ padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ac)", fontSize: 11.5, fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ac)", boxShadow: "0 0 12px rgba(57,255,106,.5)" }} />
              Preview link is live
            </div>
            <div style={{ marginTop: 6, color: "var(--t2)", fontSize: 10.5 }}>{formatExpiry(result.expiresAt)}</div>

            {resultOutdated ? (
              <div role="status" style={{ marginTop: 12, padding: "10px 12px", border: "1px solid rgba(255,184,77,.35)", background: "rgba(255,184,77,.06)", color: "#ffbd66", fontSize: 10.5, lineHeight: 1.5 }}>
                This link contains an earlier draft version. Turn it off, then create a new link to share your latest edits.
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
              <input
                ref={linkInputRef}
                data-autofocus=""
                readOnly
                value={result.url}
                aria-label="Preview link"
                onFocus={(event) => event.currentTarget.select()}
                style={{ minWidth: 0, height: 36, flex: 1, padding: "0 10px", border: "1px solid var(--bd)", borderRadius: 2, background: "var(--bg)", color: "var(--t2)", outline: "none", fontFamily: "inherit", fontSize: 10.5 }}
              />
              <button type="button" onClick={copyLink} disabled={busy} style={{ ...buttonStyle, minWidth: 86, height: 36, background: "var(--ac)", border: 0, color: "#050505", fontWeight: 800, opacity: busy ? 0.55 : 1 }}>
                {copyState === "copied" ? "Copied" : "Copy link"}
              </button>
            </div>
            <div role="status" aria-live="polite" style={{ minHeight: 18, paddingTop: 5, color: copyState === "failed" ? "var(--red)" : "var(--t3)", fontSize: 9.5 }}>
              {copyState === "failed" ? "Couldn’t access the clipboard. Select and copy the link above." : copyState === "copied" ? "Link copied to clipboard" : "Anyone with this link can read and copy the text."}
            </div>

            <div style={{ marginTop: 12, padding: "12px 13px", background: "var(--bg-el)", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.55 }}>
              This link keeps showing the version you published, even as you keep editing the draft. Shared files use the original when available, with a high-quality web-size file as the fallback.
            </div>

            {error ? <div role="alert" style={{ marginTop: 12, color: "var(--red)", fontSize: 11 }}>{error}</div> : null}

            {confirmingRevoke ? (
              <div style={{ marginTop: 18, padding: 14, border: "1px solid rgba(255,92,92,.45)", background: "rgba(255,92,92,.06)", borderRadius: 2 }}>
                <div style={{ color: "var(--t1)", fontSize: 12, fontWeight: 700 }}>Turn off this link?</div>
                <div style={{ marginTop: 5, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.5 }}>New visits lose access right away. A file already open may finish loading. The draft and source files stay in your Workspace.</div>
                <div style={{ display: "flex", gap: 7, marginTop: 12 }}>
                  <button ref={keepLinkRef} type="button" onClick={() => setConfirmingRevoke(false)} disabled={busy} style={{ ...buttonStyle, flex: 1, opacity: busy ? 0.5 : 1 }}>Keep link</button>
                  <button type="button" onClick={() => onRevoke(result.shareId)} disabled={busy} style={{ ...buttonStyle, flex: 1, background: "#ff5c5c", borderColor: "#ff5c5c", color: "#fff", fontWeight: 700, opacity: busy ? 0.55 : 1 }}>
                    {busy ? "Turning off…" : "Turn off link"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 18 }}>
                <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ ...buttonStyle, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: 1, textDecoration: "none" }}>Open preview ↗</a>
                <button type="button" onClick={() => setConfirmingRevoke(true)} disabled={busy} style={{ ...buttonStyle, flex: 1, borderColor: "transparent", color: "var(--red)", opacity: busy ? 0.5 : 1 }}>Turn off link</button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: 20 }}>
            <div style={{ padding: "12px 13px", background: "var(--bg-el)", border: "1px solid var(--bd)", borderRadius: 2 }}>
              <div style={{ color: "var(--t1)", fontSize: 11.5, fontWeight: 700 }}>A stable publishing checkpoint</div>
              <div style={{ marginTop: 5, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.55 }}>The link shows the draft exactly as it is right now — text, order, crops and layout. Later edits create a new version instead of silently changing what you already sent.</div>
            </div>

            <fieldset disabled={busy} style={{ margin: "18px 0 0", padding: 0, border: 0 }}>
              <legend style={{ color: "var(--t2)", fontSize: 10, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase" }}>Link expiry</legend>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {([
                  [7, "7 days"],
                  [30, "30 days"],
                  [null, "Never"],
                ] as const).map(([value, label]) => (
                  <button key={label} type="button" aria-pressed={expiresInDays === value} onClick={() => setExpiresInDays(value)} style={expiryButtonStyle(expiresInDays === value, busy)}>
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 18, padding: "12px 13px", border: "1px solid var(--bd)", borderRadius: 2, cursor: busy ? "default" : "pointer" }}>
              <input type="checkbox" checked={allowDownloads} disabled={busy} onChange={(event) => setAllowDownloads(event.target.checked)} style={{ width: 18, height: 18, margin: 0, accentColor: "var(--ac)" }} />
              <span>
                <span style={{ display: "block", color: "var(--t1)", fontSize: 11.5, fontWeight: 700 }}>Let visitors download media</span>
                <span style={{ display: "block", marginTop: 4, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.5 }}>Original files when available; otherwise a high-quality web-size file. Originals may retain camera and location metadata. Text can always be copied.</span>
              </span>
            </label>

            {error ? <div role="alert" style={{ marginTop: 12, color: "var(--red)", fontSize: 11 }}>{error}</div> : null}

            <div style={{ display: "flex", gap: 7, marginTop: 20 }}>
              <button data-autofocus="" type="button" onClick={() => onCreate({ expiresInDays, allowDownloads })} disabled={busy} style={{ ...buttonStyle, flex: 1, background: "var(--ac)", border: 0, color: "#050505", fontWeight: 800, opacity: busy ? 0.55 : 1 }}>
                {busy ? "Creating link…" : "Create preview link"}
              </button>
              <button type="button" onClick={close} disabled={busy} style={{ ...buttonStyle, flex: 1, opacity: busy ? 0.5 : 1 }}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SharePreviewDialog({ open, ...props }: SharePreviewDialogProps) {
  if (!open) return null;
  return <SharePreviewDialogContent {...props} />;
}
