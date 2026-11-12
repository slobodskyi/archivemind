"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  CAPTION_LANG_NAMES,
  OFFERED_CAPTION_LANGS,
  SINGLE_PUT_MAX_BYTES,
  captionStyleSchema,
  type CaptionStyleKey,
  type OfferedCaptionLang,
} from "@archivemind/shared";
import Dialog, { DialogButton } from "@/components/modals/Dialog";
import { REPLAY_BLOCK_CLASS } from "@/lib/analytics";
import { LABEL_COLORS } from "@/lib/labels";
import {
  PROJECT_SHARE_DEFAULT_EXPIRY_DAYS,
  PROJECT_SHARE_EXPIRY_DAYS,
  PROJECT_SHARE_LABEL_MAX,
  PROJECT_SHARE_LIVE_LIMIT,
  PROJECT_SHARE_MAX_BYTES,
  PROJECT_SHARE_MAX_FILES,
  liveShareCount,
  listProjectSharesResponseSchema,
  projectShareResponseSchema,
  type ProjectShareExpiryDays,
  type ProjectShareMode,
  type ProjectShareSummary,
} from "@/lib/project-shares";
import {
  CAPTION_STYLE_TITLES,
  countedFiles,
  resolveShareScopes,
  shareDetailsLabel,
  shareScopeHeading,
  shareScopeLabel,
  shareScopeReach,
  type ShareScopeOption,
  type ShareScopes,
} from "@/lib/share-scope";
import { formatBytes, formatCount } from "@/lib/usage-format";

/** Share by link (ADR 0051, scopes ADR 0053): make one — of the whole
 *  project, one Workspace, or a fixed list of files — then copy, extend or
 *  turn off every link the project already has. The dialog talks to
 *  /api/projects/[id]/shares and /api/project-shares/[id] itself, so a caller
 *  only says which project and what it could share from where it stands. */

export interface ShareDialogProps {
  open: boolean;
  project: { id: string; name: string } | null;
  /** What this Share can carry, narrowest first (`resolveShareScopes`). Left
   *  out, the dialog shares the project alone — the hub card's case. */
  scopes?: ShareScopes;
  onClose: () => void;
  /** The project's live-link count as the dialog closes, so the card's
   *  marker follows without a reload. */
  onLiveCountChange?: (projectId: string, liveShares: number) => void;
}

const MODE_ORDER: readonly ProjectShareMode[] = ["download", "upload", "both"];

const MODE_TITLE: Record<ProjectShareMode, string> = {
  download: "View & download",
  upload: "Send files only",
  both: "View, download & send",
};

/** "this project" / "this Workspace" / "these files" — what a mode acts on. */
function scopeNoun(scope: ShareScopeOption["scope"]): string {
  return scope === "board" ? "this Workspace" : scope === "selection" ? "these files" : "this project";
}

function modeDetail(mode: ProjectShareMode, scope: ShareScopeOption["scope"]): string {
  if (scope === "selection" && mode !== "download") return "A list of files can’t receive new ones — share a Workspace for that.";
  const noun = scopeNoun(scope);
  if (mode === "download") return scope === "selection" ? "Browse these files and download them." : `Browse ${noun}’s files and download them.`;
  if (mode === "upload") return `Add files to ${noun} without seeing anything already in it.`;
  return "Browse and download the files, and add new ones.";
}

function modeReach(mode: ProjectShareMode, scope: ShareScopeOption["scope"]): string {
  const noun = scopeNoun(scope);
  if (mode === "download") return scope === "selection" ? "Anyone with this link can browse and download these files." : `Anyone with this link can browse and download ${noun}’s files.`;
  if (mode === "upload") return `Anyone with this link can send files into ${noun} — and sees nothing in it.`;
  return "Anyone with this link can browse, download and send files.";
}

function ColorDot({ color }: { color: keyof typeof LABEL_COLORS | null }) {
  if (!color) return null;
  return <span aria-hidden="true" style={{ display: "inline-block", flex: "0 0 auto", width: 7, height: 7, borderRadius: "50%", background: LABEL_COLORS[color] }} />;
}

const buttonStyle: CSSProperties = {
  minHeight: 36,
  padding: "0 12px",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "transparent",
  color: "var(--t2)",
  fontFamily: "inherit",
  fontSize: 11,
  cursor: "pointer",
};

function choiceStyle(active: boolean, disabled: boolean): CSSProperties {
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

function optionStyle(active: boolean, disabled: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 12px",
    border: `1px solid ${active ? "var(--bdh)" : "var(--bd)"}`,
    borderRadius: 2,
    background: active ? "var(--bg-el)" : "transparent",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}

const legendStyle: CSSProperties = {
  padding: 0,
  color: "var(--t2)",
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: ".07em",
  textTransform: "uppercase",
};

const linkInputStyle: CSSProperties = {
  minWidth: 0,
  height: 36,
  flex: 1,
  padding: "0 10px",
  border: "1px solid var(--bd)",
  borderRadius: 2,
  background: "var(--bg)",
  color: "var(--t2)",
  outline: "none",
  fontFamily: "inherit",
  fontSize: 10.5,
};

const errorBodySchema = z.object({ error: z.string() });

function errorCopy(code: string | null): string {
  switch (code) {
    case "editor_required":
      return "Only editors can share this project.";
    case "owner_required":
      return "Only the person who made this link, or a workspace owner, can extend it.";
    case "share_limit":
      return `This project already has ${PROJECT_SHARE_LIVE_LIMIT} live links. Turn one off to make another.`;
    case "share_revoked":
      return "That link was already turned off.";
    case "board_unavailable":
      return "That Workspace can’t be shared any more — it may have been moved to Trash.";
    case "selection_empty":
      return "None of those files are in this project any more.";
    case "invalid_selection":
      return "That list can’t be shared. Pick up to 2,000 files from this project.";
    case "invalid_rights":
      return "A list of files can only be viewed and downloaded.";
    case "invalid_details":
      return "Those details can’t be shown on this link. A send-only link shows nothing about files, and Workspaces show only on a whole-project link.";
    case "unauthorized":
      return "Your session has ended. Sign in again to manage links.";
    default:
      return "Couldn’t update the project’s links. Try again.";
  }
}

async function failureCopy(resp: Response): Promise<string> {
  const body: unknown = await resp.json().catch(() => null);
  const parsed = errorBodySchema.safeParse(body);
  return errorCopy(parsed.success ? parsed.data.error : null);
}

type SharesResult = { ok: true; shares: ProjectShareSummary[] } | { ok: false; error: string };

async function fetchShares(projectId: string): Promise<SharesResult> {
  try {
    const resp = await fetch(`/api/projects/${projectId}/shares`, { cache: "no-store" });
    if (!resp.ok) return { ok: false, error: await failureCopy(resp) };
    const parsed = listProjectSharesResponseSchema.safeParse(await resp.json());
    return parsed.success ? { ok: true, shares: parsed.data.shares } : { ok: false, error: errorCopy(null) };
  } catch {
    return { ok: false, error: errorCopy(null) };
  }
}

function shareUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

function formatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatMoment(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function counted(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

function dayLabel(days: ProjectShareExpiryDays): string {
  return days === 1 ? "1 day" : `${days} days`;
}

function statusLine(share: ProjectShareSummary): string {
  if (share.status === "live") return `Live · expires ${formatMoment(share.expiresAt)}`;
  if (share.status === "expired") return `Expired ${formatMoment(share.expiresAt)}`;
  if (share.scope === "board") {
    return share.boardName
      ? "Paused — its Workspace is in Trash, or the person who made it no longer has editor access"
      : "Off — its Workspace was deleted";
  }
  return "Paused — the person who made it no longer has editor access";
}

/** What a link carries, as a chip: the scope and how many files it holds
 *  right now (a Workspace link follows its Workspace, so this moves). */
function ScopeChip({ share }: { share: ProjectShareSummary }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: "100%",
        padding: "2px 6px",
        border: "1px solid var(--bd)",
        borderRadius: 2,
        color: "var(--t2)",
        fontSize: 9.5,
        letterSpacing: ".02em",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {share.scope === "board" ? <ColorDot color={share.boardColor} /> : null}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{shareScopeLabel(share)}</span>
      {share.fileCount !== null ? <span style={{ color: "var(--t3)" }}>· {countedFiles(share.fileCount)}</span> : null}
    </span>
  );
}

function activityLine(share: ProjectShareSummary): string {
  const parts = [share.lastOpenedAt ? `Last opened ${formatDay(share.lastOpenedAt)}` : "Not opened yet"];
  if (share.mode !== "upload") parts.push(counted(share.downloadCount, "download", "downloads"));
  if (share.mode !== "download") {
    parts.push(
      share.filesReceived
        ? `${counted(share.filesReceived, "file", "files")} received · ${formatBytes(share.bytesReceived)}`
        : "No files received",
    );
  }
  if (share.createdByName) parts.push(`made by ${share.createdByName}`);
  return parts.join(" · ");
}

function StatusDot({ status }: { status: ProjectShareSummary["status"] }) {
  const skin: CSSProperties =
    status === "live"
      ? { background: "var(--ac)", boxShadow: "0 0 12px rgba(57,255,106,.5)" }
      : status === "inactive"
        ? { background: "#ffbd66" }
        : { border: "1px solid var(--t3)" };
  return <span aria-hidden="true" style={{ flex: "0 0 auto", width: 7, height: 7, boxSizing: "border-box", borderRadius: "50%", ...skin }} />;
}

interface ShareRowProps {
  share: ProjectShareSummary;
  busy: boolean;
  /** Just made: its address and Copy sit in the block above the list. */
  fresh: boolean;
  /** The last copy attempt on this row: true copied, false failed, null none. */
  copied: boolean | null;
  extending: boolean;
  revoking: boolean;
  onCopy: (url: string) => void;
  onStartExtend: () => void;
  onExtend: (days: ProjectShareExpiryDays) => void;
  onStartRevoke: () => void;
  onRevoke: () => void;
  onCancel: () => void;
  /** Open the project's canvas with what this link brought in selected. */
  onShowOnCanvas: () => void;
}

function ShareRow({
  share,
  busy,
  fresh,
  copied,
  extending,
  revoking,
  onCopy,
  onStartExtend,
  onExtend,
  onStartRevoke,
  onRevoke,
  onCancel,
  onShowOnCanvas,
}: ShareRowProps) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const firstDaysRef = useRef<HTMLButtonElement>(null);
  const url = share.path ? shareUrl(share.path) : null;
  const expired = share.status === "expired";
  const detailsLine = shareDetailsLabel(share.details);

  useEffect(() => {
    if (revoking) keepRef.current?.focus();
  }, [revoking]);

  useEffect(() => {
    if (extending) firstDaysRef.current?.focus();
  }, [extending]);

  return (
    <li style={{ listStyle: "none", padding: "12px 0", borderTop: "1px solid var(--bd)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <StatusDot status={share.status} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: share.status === "live" ? "var(--t1)" : "var(--t2)", fontSize: 12, fontWeight: 700 }}>
          {share.label || MODE_TITLE[share.mode]}
        </span>
        {url && !fresh ? (
          <button type="button" onClick={() => onCopy(url)} disabled={busy} style={{ ...buttonStyle, minHeight: 30, flex: "0 0 auto", color: "var(--t1)", opacity: busy ? 0.5 : 1 }}>
            {copied ? "Copied" : "Copy link"}
          </button>
        ) : null}
      </div>
      <div style={{ marginTop: 5, paddingLeft: 15, display: "flex" }}>
        <ScopeChip share={share} />
      </div>
      {detailsLine ? (
        <div style={{ marginTop: 4, paddingLeft: 15, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.5 }}>{detailsLine}</div>
      ) : null}
      <div style={{ marginTop: 4, paddingLeft: 15, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.5 }}>
        {share.label ? `${MODE_TITLE[share.mode]} · ` : ""}
        {statusLine(share)}
      </div>
      <div style={{ paddingLeft: 15, color: "var(--t3)", fontSize: 10, lineHeight: 1.5 }}>{activityLine(share)}</div>

      {share.status === "live" && !url ? (
        <div style={{ marginTop: 4, paddingLeft: 15, color: "var(--t3)", fontSize: 10, lineHeight: 1.5 }}>
          This link still works, but its address can’t be shown again. Make a new link if you need to send it again.
        </div>
      ) : null}

      {copied === false && url && !fresh ? (
        <div style={{ marginTop: 8, paddingLeft: 15 }}>
          <div style={{ display: "flex" }}>
            {/* A live address is a key: never in a session replay. */}
            <input className={REPLAY_BLOCK_CLASS} readOnly value={url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} style={linkInputStyle} />
          </div>
          <div role="alert" style={{ paddingTop: 5, color: "var(--red)", fontSize: 9.5 }}>Couldn’t access the clipboard. Select and copy the link above.</div>
        </div>
      ) : null}

      {revoking ? (
        <div style={{ marginTop: 10, marginLeft: 15, padding: 12, border: "1px solid rgba(255,92,92,.45)", background: "rgba(255,92,92,.06)", borderRadius: 2 }}>
          <div style={{ color: "var(--t1)", fontSize: 11.5, fontWeight: 700 }}>{expired ? "Remove this link?" : "Turn off this link?"}</div>
          <div style={{ marginTop: 4, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.5 }}>
            {expired
              ? "It can’t be renewed afterwards. Files it already received stay in the project."
              : "Anyone holding it loses access with their next click, and it can’t be turned back on. Files it already received stay in the project."}
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 10 }}>
            <button ref={keepRef} type="button" onClick={onCancel} disabled={busy} style={{ ...buttonStyle, flex: 1, opacity: busy ? 0.5 : 1 }}>Keep link</button>
            <button type="button" onClick={onRevoke} disabled={busy} style={{ ...buttonStyle, flex: 1, background: "#ff5c5c", borderColor: "#ff5c5c", color: "#fff", fontWeight: 700, opacity: busy ? 0.55 : 1 }}>
              {busy ? "Working…" : expired ? "Remove link" : "Turn off link"}
            </button>
          </div>
        </div>
      ) : extending ? (
        <div role="group" aria-label="New expiry" style={{ marginTop: 8, paddingLeft: 15 }}>
          <div style={{ color: "var(--t2)", fontSize: 10.5 }}>Expire in — counted from now; the link stays the same:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {PROJECT_SHARE_EXPIRY_DAYS.map((days, index) => (
              <button key={days} ref={index === 0 ? firstDaysRef : undefined} type="button" onClick={() => onExtend(days)} disabled={busy} style={{ ...choiceStyle(false, busy), minHeight: 30 }}>
                {dayLabel(days)}
              </button>
            ))}
            <button type="button" onClick={onCancel} disabled={busy} style={{ ...buttonStyle, minHeight: 30, borderColor: "transparent", opacity: busy ? 0.5 : 1 }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, marginTop: 8, paddingLeft: 15 }}>
          {share.status !== "inactive" ? (
            <button type="button" onClick={onStartExtend} disabled={busy} style={{ ...buttonStyle, minHeight: 30, opacity: busy ? 0.5 : 1 }}>
              {expired ? "Renew" : "Extend"}
            </button>
          ) : null}
          {/* Files received stay after a link is turned off, so this shows on
              every row that brought any — the count says whether it has. */}
          {share.filesReceived > 0 ? (
            <button type="button" onClick={onShowOnCanvas} disabled={busy} style={{ ...buttonStyle, minHeight: 30, opacity: busy ? 0.5 : 1 }}>
              Show on canvas
            </button>
          ) : null}
          <button type="button" onClick={onStartRevoke} disabled={busy} style={{ ...buttonStyle, minHeight: 30, borderColor: "transparent", color: "var(--red)", opacity: busy ? 0.5 : 1 }}>
            {expired ? "Remove" : "Turn off"}
          </button>
        </div>
      )}
    </li>
  );
}

/** The privacy line under the form: what stays inside whatever the boxes say
 *  (ADR 0053 §3's "still never sent"), plus every detail left off. */
function neverShownLine(details: { boards: boolean; labels: boolean; tags: boolean; caption: unknown }): string {
  const hidden = [
    details.tags ? null : "tags",
    details.caption ? null : "captions",
    details.labels ? null : "colour labels",
    details.boards ? null : "Workspaces",
    "AI descriptions",
    "facts",
    "notes",
  ].filter((part): part is string => part !== null);
  const list = `${hidden.slice(0, -1).join(", ")} and ${hidden[hidden.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} are never shown.`;
}

/** Why the Workspace filter is off the table for this scope (ADR 0053 §3). */
function boardsDetail(scope: ShareScopeOption["scope"]): string {
  if (scope === "board") return "Not on a Workspace link — the Workspace is what it shares.";
  if (scope === "selection") return "Not on a list of files — there is nothing to filter it by.";
  return "Their names, as a filter over the project’s files.";
}

interface ShareDetailsFieldsetProps {
  busy: boolean;
  offered: boolean;
  boardsOffered: boolean;
  scope: ShareScopeOption["scope"];
  showBoards: boolean;
  showLabels: boolean;
  showTags: boolean;
  captionOn: boolean;
  captionLang: OfferedCaptionLang;
  captionStyle: CaptionStyleKey;
  onShowBoards: (on: boolean) => void;
  onShowLabels: (on: boolean) => void;
  onShowTags: (on: boolean) => void;
  onCaptionOn: (on: boolean) => void;
  onCaptionLang: (lang: OfferedCaptionLang) => void;
  onCaptionStyle: (style: CaptionStyleKey) => void;
}

function DetailCheck({
  checked,
  disabled,
  title,
  detail,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  title: string;
  detail: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 15, height: 15, margin: "1px 0 0", flex: "0 0 auto", accentColor: "var(--ac)" }}
      />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", color: "var(--t1)", fontSize: 11.5, fontWeight: 700 }}>{title}</span>
        <span style={{ display: "block", marginTop: 2, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.45 }}>{detail}</span>
      </span>
    </label>
  );
}

/** "Visible to recipient" (ADR 0053 §3): four opt-in details, all off by
 *  default. Each is fixed for the link's life — the copy says so, because a
 *  URL someone already holds must never quietly start showing more. */
function ShareDetailsFieldset(props: ShareDetailsFieldsetProps) {
  const { busy, offered, boardsOffered, scope } = props;
  return (
    <fieldset disabled={busy} style={{ margin: "18px 0 0", padding: 0, border: 0 }}>
      <legend style={legendStyle}>Visible to recipient</legend>
      <div style={{ marginTop: 4, color: "var(--t3)", fontSize: 10, lineHeight: 1.45 }}>
        Off unless you tick it. Fixed for the life of the link.
      </div>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        <DetailCheck
          checked={props.showBoards}
          disabled={!boardsOffered}
          title="Workspaces"
          detail={boardsDetail(scope)}
          onChange={props.onShowBoards}
        />
        <DetailCheck
          checked={props.showLabels}
          disabled={!offered}
          title="Colour labels"
          detail="Each file’s colour, and a colour filter."
          onChange={props.onShowLabels}
        />
        <DetailCheck
          checked={props.showTags}
          disabled={!offered}
          title="Tags"
          detail="The AI tag names on each file, and a tag filter."
          onChange={props.onShowTags}
        />
        <DetailCheck
          checked={props.captionOn}
          disabled={!offered}
          title="Caption"
          detail="Exactly one language and style. A file without that caption shows none."
          onChange={props.onCaptionOn}
        />
        {offered && props.captionOn ? (
          <div style={{ display: "grid", gap: 6, paddingLeft: 25 }}>
            <div role="group" aria-label="Caption language" style={{ display: "flex", gap: 6 }}>
              {OFFERED_CAPTION_LANGS.map((lang) => (
                <button key={lang} type="button" aria-pressed={props.captionLang === lang} onClick={() => props.onCaptionLang(lang)} style={choiceStyle(props.captionLang === lang, busy)}>
                  {CAPTION_LANG_NAMES[lang]}
                </button>
              ))}
            </div>
            <div role="group" aria-label="Caption style" style={{ display: "flex", gap: 6 }}>
              {captionStyleSchema.options.map((style) => (
                <button key={style} type="button" aria-pressed={props.captionStyle === style} onClick={() => props.onCaptionStyle(style)} style={choiceStyle(props.captionStyle === style, busy)}>
                  {CAPTION_STYLE_TITLES[style]}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {offered ? null : (
        <div style={{ marginTop: 8, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.45 }}>
          A send-only link shows no files, so it shows nothing about them.
        </div>
      )}
    </fieldset>
  );
}

const PROJECT_ONLY: ShareScopes = resolveShareScopes({ selectionIds: [], activeBoard: null, projectCount: null });

function optionTitle(option: ShareScopeOption): string {
  if (option.scope === "selection") return `${countedFiles(option.count)} selected`;
  if (option.scope === "board") return `Workspace “${option.name}”`;
  return "Whole project";
}

function optionDetail(option: ShareScopeOption, projectName: string): string {
  if (option.unavailable) return option.unavailable;
  if (option.scope === "selection") return "A fixed list: it never grows. View & download only.";
  if (option.scope === "board") return `${countedFiles(option.count)} · follows the Workspace as files are added or removed`;
  const count = option.count !== null ? `${countedFiles(option.count)} · ` : "";
  return `${count}everything in “${projectName}”, now and later`;
}

function ShareDialogContent({
  project,
  scopes = PROJECT_ONLY,
  onClose,
  onLiveCountChange,
}: Omit<ShareDialogProps, "open" | "project"> & { project: { id: string; name: string } }) {
  const [shares, setShares] = useState<ProjectShareSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Opened on something narrower than the project, the owner came to share
  // THAT: start on the form, with the existing links one Back away.
  const [wantsForm, setWantsForm] = useState(scopes.initial !== "project");
  const [scope, setScope] = useState(scopes.initial);
  const [chosenMode, setMode] = useState<ProjectShareMode>("download");
  const [expiresInDays, setExpiresInDays] = useState<ProjectShareExpiryDays>(PROJECT_SHARE_DEFAULT_EXPIRY_DAYS);
  const [label, setLabel] = useState("");
  // What the recipient sees beside the files (ADR 0053 §3) — all off, so the
  // default link is still the ADR 0051 one: files and nothing else.
  const [showBoards, setShowBoards] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [captionOn, setCaptionOn] = useState(false);
  const [captionLang, setCaptionLang] = useState<OfferedCaptionLang>("en");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleKey>("agency");
  const [created, setCreated] = useState<{ id: string; url: string; mode: ProjectShareMode; scope: ShareScopeOption["scope"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    let live = true;
    void (async () => {
      const result = await fetchShares(project.id);
      if (!live) return;
      if (result.ok) setShares(result.shares);
      else setLoadError(result.error);
    })();
    return () => {
      live = false;
    };
  }, [project.id]);

  const option = scopes.options.find((candidate) => candidate.scope === scope) ?? scopes.options[scopes.options.length - 1];
  // A list never grows, so it cannot receive files (ADR 0053 §1): the mode
  // falls back to download for as long as a list is the scope.
  const listOnly = option.scope === "selection";
  const mode: ProjectShareMode = listOnly ? "download" : chosenMode;
  const unavailable = option.unavailable !== null;
  // A send-only link shows no files, so it can show nothing about them; and
  // on a Workspace or a list the Workspace filter means nothing. What is not
  // offered is never sent, whatever the boxes said a moment ago.
  const detailsOffered = mode !== "upload";
  const boardsOffered = detailsOffered && option.scope === "project";
  const details = {
    boards: boardsOffered && showBoards,
    labels: detailsOffered && showLabels,
    tags: detailsOffered && showTags,
    caption: detailsOffered && captionOn ? { lang: captionLang, style: captionStyle } : null,
  };
  const loading = shares === null && loadError === null;
  const hasShares = Boolean(shares?.length);
  // A project with no links opens straight on the form: there is nothing to
  // manage yet, and making one is the only reason to be here.
  const creating = shares !== null && (wantsForm || !hasShares);
  const liveCount = shares ? liveShareCount(shares) : 0;
  const atLimit = liveCount >= PROJECT_SHARE_LIVE_LIMIT;
  const createdLive = created && shares?.some((share) => share.id === created.id && share.status === "live") ? created : null;
  const copiedFor = (id: string) => (copied?.id === id ? copied.ok : null);

  const close = () => {
    if (shares) onLiveCountChange?.(project.id, liveCount);
    onClose();
  };

  const refresh = async () => {
    const result = await fetchShares(project.id);
    if (result.ok) setShares(result.shares);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = label.trim();
      const resp = await fetch(`/api/projects/${project.id}/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          expiresInDays,
          ...(trimmed ? { label: trimmed } : {}),
          scope: option.scope,
          ...(option.scope === "board" ? { boardId: option.boardId } : {}),
          ...(option.scope === "selection" ? { assetIds: option.assetIds } : {}),
          showBoards: details.boards,
          showLabels: details.labels,
          showTags: details.tags,
          ...(details.caption ? { caption: details.caption } : {}),
        }),
      });
      if (!resp.ok) {
        setError(await failureCopy(resp));
        return;
      }
      const parsed = projectShareResponseSchema.safeParse(await resp.json());
      const share = parsed.success ? parsed.data.share : null;
      if (!share?.path) {
        // The link exists but the answer didn't parse — the list still has it.
        await refresh();
        setWantsForm(false);
        return;
      }
      setShares((list) => [share, ...(list ?? []).filter((item) => item.id !== share.id)]);
      setCreated({ id: share.id, url: shareUrl(share.path), mode: share.mode, scope: share.scope });
      setCopied(null);
      setLabel("");
      setWantsForm(false);
    } catch {
      setError(errorCopy(null));
    } finally {
      setBusy(false);
    }
  };

  const change = async (shareId: string, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(`/api/project-shares/${shareId}`, init);
      if (!resp.ok) setError(await failureCopy(resp));
    } catch {
      setError(errorCopy(null));
    }
    // Re-read either way: success moves an expiry or drops a row, and a
    // failure usually means this list is stale (turned off elsewhere).
    await refresh();
    setExtendingId(null);
    setRevokingId(null);
    setBusy(false);
  };

  const copy = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied({ id, ok: true });
    } catch {
      setCopied({ id, ok: false });
    }
  };

  const openForm = () => {
    setWantsForm(true);
    setCreated(null);
    setError(null);
    setExtendingId(null);
    setRevokingId(null);
  };

  const headerAction = !creating && hasShares ? (
    <button
      type="button"
      onClick={openForm}
      disabled={busy || atLimit}
      title={atLimit ? `A project can have ${PROJECT_SHARE_LIVE_LIMIT} live links` : undefined}
      style={{ ...buttonStyle, minHeight: 28, padding: "0 10px", color: "var(--t1)", fontWeight: 700, opacity: busy || atLimit ? 0.5 : 1 }}
    >
      + New link
    </button>
  ) : undefined;

  const footer = loading || loadError ? (
    <DialogButton key="close" data-autofocus="" onClick={close}>Close</DialogButton>
  ) : creating ? (
    // Keyed per phase: React would otherwise reuse the focused Close as Cancel,
    // and focus would never move on to this phase's own [data-autofocus].
    <>
      <DialogButton
        key="back"
        onClick={hasShares ? () => { setWantsForm(false); setError(null); } : close}
        disabled={busy}
      >
        {hasShares ? "Back" : "Cancel"}
      </DialogButton>
      <DialogButton key="create" type="submit" form="share-project-form" variant="primary" disabled={busy || atLimit || unavailable}>
        {busy ? "Creating link…" : "Create link"}
      </DialogButton>
    </>
  ) : (
    <DialogButton key="done" data-autofocus={createdLive ? undefined : ""} onClick={close} disabled={busy}>Done</DialogButton>
  );

  // The form is titled by what it is about to share; the list by the project
  // whose links it shows — every scope's links live there.
  const heading = creating
    ? option.scope === "selection"
      ? `Share ${countedFiles(option.count)}`
      : `Share “${shareScopeHeading({ scope: option.scope, projectName: project.name, boardName: option.scope === "board" ? option.name : null })}”`
    : `Share “${project.name}”`;
  const kicker = creating && option.scope === "board"
    ? `Share workspace · ${project.name}`
    : creating && option.scope === "selection"
      ? `Share files · ${project.name}`
      : "Share project";

  return (
    <Dialog
      open
      size="m"
      kicker={kicker}
      title={heading}
      subtitle="Anyone with a link can use it — no ArchiveMind account needed. Every link expires, and you can turn it off at any time."
      headerAction={headerAction}
      busy={busy}
      refocusKey={`${loading}:${creating}:${createdLive?.id ?? ""}`}
      onClose={close}
      footer={footer}
      bodyStyle={{ padding: "16px 20px 20px" }}
    >
      {loading ? (
        <div role="status" style={{ color: "var(--t3)", fontSize: 11 }}>Loading links…</div>
      ) : loadError ? (
        <div role="alert" style={{ color: "var(--red)", fontSize: 11 }}>{loadError}</div>
      ) : creating ? (
        <form
          id="share-project-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !atLimit && !unavailable) void create();
          }}
        >
          {/* Only when there is a choice: from the hub the project is all
              there is, and the title already names it. */}
          {scopes.options.length > 1 ? (
            <fieldset disabled={busy} style={{ margin: "0 0 18px", padding: 0, border: 0 }}>
              <legend style={legendStyle}>What</legend>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {scopes.options.map((candidate) => {
                  const active = candidate.scope === option.scope;
                  const off = candidate.unavailable !== null;
                  return (
                    <label key={candidate.scope} style={optionStyle(active, busy || off)}>
                      <input
                        type="radio"
                        name="share-scope"
                        value={candidate.scope}
                        checked={active}
                        disabled={off}
                        onChange={() => setScope(candidate.scope)}
                        data-autofocus={active ? "" : undefined}
                        style={{ width: 16, height: 16, margin: "1px 0 0", flex: "0 0 auto", accentColor: "var(--ac)" }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--t1)", fontSize: 11.5, fontWeight: 700 }}>
                          {candidate.scope === "board" ? <ColorDot color={candidate.color} /> : null}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{optionTitle(candidate)}</span>
                        </span>
                        <span style={{ display: "block", marginTop: 3, color: off ? "var(--red)" : "var(--t2)", fontSize: 10.5, lineHeight: 1.45 }}>
                          {optionDetail(candidate, project.name)}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <fieldset disabled={busy} style={{ margin: 0, padding: 0, border: 0 }}>
            <legend style={legendStyle}>People with the link can</legend>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {MODE_ORDER.map((value, index) => {
                const blocked = listOnly && value !== "download";
                return (
                  <label key={value} style={optionStyle(mode === value, busy || blocked)}>
                    <input
                      type="radio"
                      name="share-mode"
                      value={value}
                      checked={mode === value}
                      disabled={blocked}
                      onChange={() => setMode(value)}
                      data-autofocus={index === 0 && scopes.options.length === 1 ? "" : undefined}
                      style={{ width: 16, height: 16, margin: "1px 0 0", flex: "0 0 auto", accentColor: "var(--ac)" }}
                    />
                    <span>
                      <span style={{ display: "block", color: "var(--t1)", fontSize: 11.5, fontWeight: 700 }}>{MODE_TITLE[value]}</span>
                      <span style={{ display: "block", marginTop: 3, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.45 }}>{modeDetail(value, option.scope)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <ShareDetailsFieldset
            busy={busy}
            offered={detailsOffered}
            boardsOffered={boardsOffered}
            scope={option.scope}
            showBoards={details.boards}
            showLabels={details.labels}
            showTags={details.tags}
            captionOn={details.caption !== null}
            captionLang={captionLang}
            captionStyle={captionStyle}
            onShowBoards={setShowBoards}
            onShowLabels={setShowLabels}
            onShowTags={setShowTags}
            onCaptionOn={setCaptionOn}
            onCaptionLang={setCaptionLang}
            onCaptionStyle={setCaptionStyle}
          />

          <fieldset disabled={busy} style={{ margin: "18px 0 0", padding: 0, border: 0 }}>
            <legend style={legendStyle}>Link expires after</legend>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {PROJECT_SHARE_EXPIRY_DAYS.map((days) => (
                <button key={days} type="button" aria-pressed={expiresInDays === days} onClick={() => setExpiresInDays(days)} style={choiceStyle(expiresInDays === days, busy)}>
                  {dayLabel(days)}
                </button>
              ))}
            </div>
          </fieldset>

          <label style={{ display: "block", marginTop: 18 }}>
            <span style={legendStyle}>Name</span>
            <span style={{ marginLeft: 6, color: "var(--t3)", fontSize: 10 }}>Optional · only your team sees it</span>
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={PROJECT_SHARE_LABEL_MAX}
              disabled={busy}
              placeholder="e.g. Agency handoff"
              style={{ ...linkInputStyle, display: "block", width: "100%", boxSizing: "border-box", marginTop: 8, color: "var(--t1)", fontSize: 11.5 }}
            />
          </label>

          <div style={{ marginTop: 18, padding: "12px 13px", background: "var(--bg-el)", border: "1px solid var(--bd)", borderRadius: 2, color: "var(--t2)", fontSize: 10.5, lineHeight: 1.55 }}>
            {mode !== "upload" ? (
              <div style={{ marginBottom: 8, color: "var(--t1)" }}>{shareScopeReach(option, project.name)}</div>
            ) : null}
            {mode !== "upload" ? (
              <div>
                Downloads are the original files where the project holds them — camera details and GPS location
                included — and a high-quality web-size copy otherwise. {neverShownLine(details)}
              </div>
            ) : null}
            {mode !== "download" ? (
              <div style={{ marginTop: mode === "both" ? 8 : 0 }}>
                Files people send land in this project
                {option.scope === "board" ? ` and in the Workspace “${option.name}”` : ""} and count toward your storage: up to{" "}
                {formatBytes(SINGLE_PUT_MAX_BYTES)} each, {formatCount(PROJECT_SHARE_MAX_FILES)} files and{" "}
                {formatBytes(PROJECT_SHARE_MAX_BYTES)} per link.
              </div>
            ) : null}
          </div>

          {error ? <div role="alert" style={{ marginTop: 12, color: "var(--red)", fontSize: 11 }}>{error}</div> : null}
        </form>
      ) : (
        <div>
          {createdLive ? (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--ac)", fontSize: 11.5, fontWeight: 700 }}>
                <StatusDot status="live" />
                Link is live
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                {/* A live address is a key: never in a session replay. */}
                <input className={REPLAY_BLOCK_CLASS} data-autofocus="" readOnly value={createdLive.url} aria-label="Share link" onFocus={(event) => event.currentTarget.select()} style={linkInputStyle} />
                <button type="button" onClick={() => void copy(createdLive.id, createdLive.url)} disabled={busy} style={{ ...buttonStyle, minWidth: 86, background: "var(--ac)", border: 0, color: "#050505", fontWeight: 800, opacity: busy ? 0.55 : 1 }}>
                  {copiedFor(createdLive.id) ? "Copied" : "Copy link"}
                </button>
              </div>
              <div role="status" aria-live="polite" style={{ minHeight: 18, paddingTop: 5, color: copiedFor(createdLive.id) === false ? "var(--red)" : "var(--t3)", fontSize: 9.5 }}>
                {copiedFor(createdLive.id) === false
                  ? "Couldn’t access the clipboard. Select and copy the link above."
                  : copiedFor(createdLive.id)
                    ? "Link copied to clipboard"
                    : modeReach(createdLive.mode, createdLive.scope)}
              </div>
            </div>
          ) : null}

          {error ? <div role="alert" style={{ marginBottom: 10, color: "var(--red)", fontSize: 11 }}>{error}</div> : null}

          <ul style={{ margin: 0, padding: 0 }}>
            {(shares ?? []).map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                busy={busy}
                fresh={share.id === createdLive?.id}
                copied={copiedFor(share.id)}
                extending={extendingId === share.id}
                revoking={revokingId === share.id}
                onCopy={(url) => void copy(share.id, url)}
                onStartExtend={() => {
                  setRevokingId(null);
                  setExtendingId(share.id);
                }}
                onExtend={(days) => void change(share.id, {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ expiresInDays: days }),
                })}
                onStartRevoke={() => {
                  setExtendingId(null);
                  setRevokingId(share.id);
                }}
                onRevoke={() => void change(share.id, { method: "DELETE" })}
                onCancel={() => {
                  setExtendingId(null);
                  setRevokingId(null);
                }}
                onShowOnCanvas={() => {
                  // The canvas asks /api/project-shares/[id]/received itself
                  // (useReceivedSelection), so a stale list here can't select
                  // a file that has since moved to Trash.
                  onClose();
                  router.push(`/projects/${project.id}?received=${share.id}`);
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

export default function ShareDialog({ open, project, ...props }: ShareDialogProps) {
  if (!open || !project) return null;
  // Keyed by project, so another card's dialog never flashes this one's links.
  return <ShareDialogContent key={project.id} project={project} {...props} />;
}
