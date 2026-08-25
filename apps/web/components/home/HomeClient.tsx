"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createProjectResponseSchema } from "@archivemind/shared";
import type { ProjectCard } from "@/lib/projects";
import type { UsageSnapshot } from "@/lib/usage";
import UsageView, { UsagePlanPill } from "@/components/account/UsageView";
import TrashView from "@/components/trash/TrashView";
import Toast from "@/components/modals/Toast";
import DataSourcesModal from "@/components/modals/DataSourcesModal";
import { useGdriveConnection } from "@/hooks/useGdriveConnection";
import { useOneDriveConnection, useOneDriveRedirectResult } from "@/hooks/useOneDriveConnection";
import RenameModal from "@/components/modals/RenameModal";
import ConfirmModal from "@/components/modals/ConfirmModal";
import AccountMenu from "@/components/home/AccountMenu";
import { navProgressStart } from "@/components/nav/TopProgressBar";
import UploadManager from "@/components/upload/UploadManager";
import { Z } from "@/lib/ui";
import HelpModal from "@/components/modals/HelpModal";
import {
  SearchIcon,
  DataSourcesIcon,
  RecentsIcon,
  ArchiveIcon,
  TrashIcon,
  UpgradeIcon,
  UsageIcon,
  MoreIcon,
  LogsIcon,
  HelpIcon,
} from "@/components/icons/icons";

/** Homepage hub (issue #17): project-only navigation and project cards.
 *  Opening a project navigates to its canvas at /projects/[id]. */

interface Account {
  initials: string;
  name: string;
  email: string;
}

const CARD_COLORS = ["#5b9bff", "#ff7a5c", "#4fd1c5", "#c084fc", "#ffd166", "#39ff6a"];
function cardColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CARD_COLORS[h % CARD_COLORS.length];
}

/** `usage` is a view here rather than its own page (ADR 0037): the sidebar is
 *  where people already look for Trash, and Trash is half of what the storage
 *  card is about. /account/usage exists as the deep link the account menus
 *  point at, and renders this same shell with the view preselected. */
export type ViewMode = "projects" | "recents" | "archived" | "trash" | "usage";

const VIEW_TITLE: Record<ViewMode, string> = {
  projects: "Projects",
  recents: "Recents",
  archived: "Archived",
  trash: "Trash",
  usage: "Usage & Storage",
};

const VIEW_EMPTY: Record<ViewMode, string> = {
  projects: "No projects yet — create one to group photos from your archive.",
  recents: "No recently opened projects yet.",
  archived: "No archived projects — archive a project to tuck it away without deleting it.",
  trash: "Trash is empty — deleted projects and photos stay here for 30 days before they're removed for good.",
  // Never shown: the usage view renders its own body, which is meaningful even
  // for an empty archive (a zeroed meter is still an answer).
  usage: "",
};

const RECENTS_KEY = "archivemind:recentProjects";
const RECENTS_MAX = 8;

function recordRecentProject(id: string) {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    const ids: string[] = raw ? JSON.parse(raw) : [];
    const next = [id, ...ids.filter((x) => x !== id)].slice(0, RECENTS_MAX);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private mode, etc.) — recents just stay empty
  }
}

export default function HomeClient({
  account,
  projects,
  initialView = "projects",
  initialUsage = null,
}: {
  account: Account;
  projects: ProjectCard[];
  /** Preselected view for a deep link (/account/usage). */
  initialView?: ViewMode;
  /** Server-fetched snapshot for that deep link, so the meters don't flash
   *  empty on a direct load. Null when arriving via the sidebar, where the
   *  view fetches on demand like Archived and Trash do. */
  initialUsage?: UsageSnapshot | null;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  /** The toast carries an optional action because every reversible thing here
   *  now offers one — including Restore, which never did (ADR 0049). */
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const [view, setView] = useState<ViewMode>(initialView);
  const [usage, setUsage] = useState<UsageSnapshot | null>(initialUsage);
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  /** Below 860px the rail is an off-canvas drawer (see `.am-home-nav`). Wider
   *  than that the rail is always in the flow and this flag does nothing —
   *  which is why it needs no viewport listener to stay honest. */
  const [navOpen, setNavOpen] = useState(false);
  const [activeProjects, setActiveProjects] = useState<ProjectCard[]>(projects);
  const [archivedProjects, setArchivedProjects] = useState<ProjectCard[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectCard | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ project: ProjectCard; action: "archive" | "delete" } | null>(null);

  /** Escape closes the drawer, the way it closes every other overlay here. The
   *  scrim is the discoverable way out and the nav items close it on their own;
   *  this is the third, for anyone on a tablet with a keyboard. */
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  const notify = (text: string, action?: { label: string; run: () => void }) => {
    setToast({ text, action });
    setTimeout(() => setToast(null), 3200); // same duration as the workspace toast
  };
  /** The plain one the connection hooks take — they call it with a severity
   *  argument this shell has always ignored, so its arity must stay at one. */
  const flash = (text: string) => notify(text);

  // Shared gdrive lifecycle (also drives the ImportModal pane) — ADR 0025.
  const {
    gdrive,
    refresh: refreshGdrive,
    connect: connectGdrive,
    disconnect: disconnectGdrive,
  } = useGdriveConnection(flash);

  // OneDrive's equivalent (ADR 0047). `connect` navigates away rather than
  // resolving, so the outcome comes back as a query parameter — see
  // useOneDriveRedirectResult below.
  const {
    onedrive,
    refresh: refreshOneDrive,
    connect: connectOneDrive,
    disconnect: disconnectOneDrive,
  } = useOneDriveConnection(flash);
  useOneDriveRedirectResult(flash, () => void refreshOneDrive());

  const openRecents = () => {
    try {
      const raw = localStorage.getItem(RECENTS_KEY);
      setRecentIds(raw ? JSON.parse(raw) : []);
    } catch {
      setRecentIds([]);
    }
    setView("recents");
  };

  async function fetchScope(scope: "archived" | "trash"): Promise<ProjectCard[]> {
    try {
      const resp = await fetch(`/api/projects?scope=${scope}`);
      if (!resp.ok) return [];
      const { projects: list } = await resp.json();
      return list as ProjectCard[];
    } catch {
      return [];
    }
  }

  /** Same lazy shape as Archived/Trash: switch first, fill in when it lands.
   *  Re-fetched on every open rather than cached — the whole point of the view
   *  is a number that changed since you last looked. */
  const openUsage = () => {
    setView("usage");
    void fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUsage(d.usage as UsageSnapshot))
      .catch(() => {
        /* leaves whatever was already on screen; the view shows its own note */
      });
  };

  const openArchived = () => {
    setView("archived");
    void fetchScope("archived").then(setArchivedProjects);
  };

  /** The view fetches its own list through GET /api/trash (ADR 0049), which is
   *  why there is nothing to seed here: projects, files, Workspaces and drafts
   *  arrive as one sorted, counted page rather than as two separate reads. */
  const openTrash = () => setView("trash");

  const baseList = view === "recents"
    ? (recentIds.map((id) => activeProjects.find((p) => p.id === id)).filter(Boolean) as ProjectCard[])
    : view === "projects"
      ? activeProjects
      : view === "archived"
        ? (archivedProjects ?? [])
        // Trash and Usage each render their own body — a trashed project is a
        // row in the Trash's own list now, not a project card (ADR 0049).
        : [];

  const q = query.trim().toLowerCase();
  const visibleProjects = q ? baseList.filter((p) => p.name.toLowerCase().includes(q)) : baseList;
  async function patchProject(id: string, patch: { name?: string; archived?: boolean; deleted?: boolean }): Promise<boolean> {
    try {
      const resp = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  async function renameProject(id: string, newName: string) {
    setRenameTarget(null);
    const ok = await patchProject(id, { name: newName });
    if (!ok) return flash("Could not rename — try again");
    const applyName = (list: ProjectCard[]) => list.map((p) => (p.id === id ? { ...p, name: newName } : p));
    setActiveProjects(applyName);
    setArchivedProjects((l) => (l ? applyName(l) : l));
    flash("Project renamed");
  }

  async function archiveProject(project: ProjectCard) {
    setConfirmTarget(null);
    const ok = await patchProject(project.id, { archived: true });
    if (!ok) return flash("Could not archive — try again");
    setActiveProjects((l) => l.filter((p) => p.id !== project.id));
    setArchivedProjects((l) => (l ? [project, ...l] : l));
    flash(`"${project.name}" archived`);
  }

  async function deleteProject(project: ProjectCard) {
    setConfirmTarget(null);
    const ok = await patchProject(project.id, { deleted: true });
    if (!ok) return flash("Could not delete — try again");
    setActiveProjects((l) => l.filter((p) => p.id !== project.id));
    setArchivedProjects((l) => (l ? l.filter((p) => p.id !== project.id) : l));
    flash(`"${project.name}" moved to Trash`);
  }

  async function restoreProject(project: ProjectCard) {
    const ok = await patchProject(project.id, { archived: false });
    if (!ok) return flash("Could not restore — try again");
    setArchivedProjects((l) => (l ? l.filter((p) => p.id !== project.id) : l));
    setActiveProjects((l) => [project, ...l]);
    flash(`"${project.name}" restored`);
  }

  function openProject(id: string) {
    recordRecentProject(id);
    navProgressStart();
    router.push(`/projects/${id}`);
  }

  async function createProject() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const resp = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      const { id } = createProjectResponseSchema.parse(await resp.json());
      navProgressStart();
      router.push(`/projects/${id}`);
    } catch {
      setBusy(false);
      flash("Could not create the project — try again");
    }
  }

  return (
    <div style={{ position: "relative", display: "flex", width: "100vw", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      {/* Only ever visible below 860px, where the rail is an overlay and needs
          something to dismiss it against. Rendered unconditionally so the CSS
          owns the breakpoint — a JS width check would have to be re-run on
          every resize and rotation to stay right. */}
      {navOpen && (
        <div
          className="am-home-scrim"
          onClick={() => setNavOpen(false)}
          style={{ display: "none", position: "fixed", inset: 0, zIndex: 59, background: "rgba(0,0,0,.55)" }}
        />
      )}

      {/* ── drawer sidebar ─────────────────────────────────────────── */}
      <aside
        className="am-home-nav"
        data-open={navOpen}
        style={{
          width: 248,
          flex: "0 0 auto",
          height: "100%",
          background: "var(--bg-s)",
          borderRight: "1px solid var(--bd)",
          display: "flex",
          flexDirection: "column",
          padding: "18px 14px 14px",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", letterSpacing: "0.04em", padding: "0 8px 14px" }}>
          ArchiveMind
        </div>

        <AccountMenu
          account={account}
          open={accountMenuOpen}
          onToggle={() => setAccountMenuOpen((v) => !v)}
          onClose={() => setAccountMenuOpen(false)}
          onFlashToast={flash}
        />

        <button
          onClick={() => {
            setSourcesOpen(true);
            void refreshGdrive();
            void refreshOneDrive();
            setNavOpen(false);
          }}
          style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", padding: "8px 8px", marginBottom: 10, background: "transparent", border: 0, borderRadius: 2, color: "var(--t2)", fontSize: 13, fontFamily: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <span style={{ display: "flex", flex: "0 0 auto" }}><DataSourcesIcon /></span>
          <span style={{ flex: 1 }}>Data Sources</span>
        </button>

        <div style={{ height: 1, background: "var(--bd)", margin: "2px 0 10px" }} />

        <div style={{ position: "relative", marginBottom: 10 }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", display: "flex", color: "var(--t3)", pointerEvents: "none" }}>
            <SearchIcon width={13} height={13} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            style={{
              width: "100%",
              height: 30,
              padding: "0 8px 0 28px",
              background: "var(--bg-in)",
              border: "1px solid var(--bd)",
              borderRadius: 2,
              color: "var(--t1)",
              fontSize: 12.5,
              fontFamily: "inherit",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Picking a destination dismisses the drawer — on the desktop rail the
            handler is a no-op, so one listener per nav covers both layouts. */}
        <nav onClick={() => setNavOpen(false)} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem label="Projects" active={view === "projects"} icon={<GridIcon />} onClick={() => setView("projects")} />
          <NavItem label="Recents" active={view === "recents"} icon={<RecentsIcon />} onClick={openRecents} />
        </nav>

        <div style={{ flex: 1 }} />

        <nav onClick={() => setNavOpen(false)} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem label="Logs" icon={<LogsIcon />} onClick={() => flash("Activity log coming soon")} />
          <NavItem label="Help" icon={<HelpIcon />} onClick={() => setHelpOpen(true)} />
          {/* Directly above Archived/Trash on purpose: the storage meter's
              biggest reclaimable slice IS the Trash, and this is where people
              already look for it. */}
          <NavItem label="Usage & Storage" active={view === "usage"} icon={<UsageIcon />} onClick={openUsage} />
          <NavItem label="Upgrade" icon={<UpgradeIcon />} onClick={() => flash("Upgrade plans — coming soon")} />
          <NavItem label="Archived" active={view === "archived"} icon={<ArchiveIcon />} onClick={openArchived} />
          <NavItem label="Trash" active={view === "trash"} icon={<TrashIcon />} onClick={openTrash} />
        </nav>
      </aside>

      {/* ── content: project cards ─────────────────────────────────── */}
      <main className="am-home-main" style={{ flex: 1, minWidth: 0, height: "100%", overflowY: "auto", padding: "26px 30px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          {/* The drawer's only handle. `display: none` inline, shown by the
              860px query — the rail is in the flow above that and a second way
              to open what is already open is just a dead control. */}
          <button
            className="am-home-burger"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            title="Menu"
            style={{ display: "none", alignItems: "center", justifyContent: "center", width: 34, height: 34, flex: "0 0 auto", marginLeft: -6, background: "transparent", border: 0, borderRadius: 2, color: "var(--t2)", cursor: "pointer" }}
          >
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          <h1 style={{ flex: 1, minWidth: 0, fontSize: 19, fontWeight: 700, color: "var(--t1)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{VIEW_TITLE[view]}</h1>
          {view === "usage" && <UsagePlanPill plan={usage?.plan ?? null} />}
          {(view === "projects" || view === "recents") && !creating && (
            <button
              onClick={() => setCreating(true)}
              // "+ New project" is 15 characters of a 390px row that also holds
              // the title and the drawer handle; on a phone the glyph carries it.
              aria-label="New project"
              style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", flex: "0 0 auto", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}
            >
              + <span className="am-home-newlabel">New project</span>
            </button>
          )}
        </div>

        {(view === "projects" || view === "recents") && creating && (
          <div style={{ display: "flex", gap: 8, marginBottom: 18, maxWidth: 420 }}>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createProject();
                if (e.key === "Escape") { setCreating(false); setName(""); }
              }}
              placeholder="Project name — e.g. Odesa 2026"
              style={{ flex: 1, padding: "10px 12px", background: "var(--bg-in)", border: "1px solid var(--bdh)", borderRadius: 2, color: "var(--t1)", fontSize: 13, fontFamily: "inherit", outline: "none" }}
            />
            <button
              onClick={() => void createProject()}
              disabled={busy || !name.trim()}
              style={{ padding: "0 16px", background: !busy && name.trim() ? "var(--ac)" : "var(--bg-el)", color: !busy && name.trim() ? "#050505" : "var(--tm)", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: !busy && name.trim() ? "pointer" : "default", fontFamily: "inherit" }}
            >
              {busy ? "…" : "Create"}
            </button>
            <button
              onClick={() => { setCreating(false); setName(""); }}
              style={{ padding: "0 12px", background: "transparent", color: "var(--t3)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
            >
              Cancel
            </button>
          </div>
        )}

        {view === "usage" &&
          (usage ? (
            <UsageView usage={usage} />
          ) : (
            <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--tm)" }}>Measuring your archive…</div>
          ))}

        {view === "trash" && <TrashView onToast={notify} />}

        <div
          className="am-home-grid"
          style={{
            display: view === "usage" || view === "trash" ? "none" : "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
            gap: 16,
          }}
        >
          {visibleProjects.map((p) => (
            <ProjectCardView
              key={p.id}
              title={p.name}
              count={p.count}
              previews={p.previews}
              accent={cardColor(p.id)}
              href={`/projects/${p.id}`}
              // An archived project's canvas redirects home (the page's guard
              // only knows active projects), so the card must not pretend to be
              // a door. Restore is the way in, and the card says so.
              disabledReason={view === "archived" ? "Restore it first to open it" : null}
              onDisabledClick={() => flash("Restore this project to open it")}
              onOpen={() => recordRecentProject(p.id)}
            >
              <CardMenu
                restoreOnly={view === "archived"}
                onOpen={() => openProject(p.id)}
                onRename={() => setRenameTarget(p)}
                onArchive={() => setConfirmTarget({ project: p, action: "archive" })}
                onDelete={() => setConfirmTarget({ project: p, action: "delete" })}
                onRestore={() => restoreProject(p)}
              />
            </ProjectCardView>
          ))}
        </div>

        {view !== "usage" &&
          view !== "trash" &&
          visibleProjects.length === 0 &&
          !((view === "projects" || view === "recents") && creating) && (
          <div style={{ marginTop: 26, fontSize: 12.5, color: "var(--tm)" }}>
            {q ? "Nothing matches your search." : VIEW_EMPTY[view]}
          </div>
        )}
      </main>

      <UploadManager projectId="all" disabled disabledMessage="OPEN A PROJECT TO UPLOAD" />

      <Toast
        show={!!toast}
        text={toast?.text ?? ""}
        actionLabel={toast?.action?.label}
        onAction={() => {
          toast?.action?.run();
          setToast(null);
        }}
      />

      <HelpModal
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        onSend={() => {
          setHelpOpen(false);
          flash("Support ticket sent — we'll be in touch within 24h");
        }}
      />

      <DataSourcesModal
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        onConnect={() => {
          setSourcesOpen(false);
          flash("Dropbox needs no connection — open a project and use Add files");
        }}
        onedrive={onedrive}
        onOneDriveConnect={connectOneDrive}
        onOneDriveDisconnect={() => void disconnectOneDrive()}
        gdrive={gdrive}
        onGdriveConnect={() => void connectGdrive()}
        onGdriveDisconnect={() => void disconnectGdrive()}
      />

      <RenameModal
        key={renameTarget?.id ?? "none"}
        open={!!renameTarget}
        initialName={renameTarget?.name ?? ""}
        onSave={(newName) => renameTarget && void renameProject(renameTarget.id, newName)}
        onClose={() => setRenameTarget(null)}
      />

      <ConfirmModal
        open={!!confirmTarget}
        title={confirmTarget?.action === "archive" ? "Archive project?" : "Delete project?"}
        body={
          confirmTarget?.action === "archive"
            ? `"${confirmTarget.project.name}" will move to Archived. You can restore it anytime.`
            : `"${confirmTarget?.project.name}" will move to Trash and be permanently removed after 30 days.`
        }
        confirmLabel={confirmTarget?.action === "archive" ? "Archive" : "Delete"}
        danger={confirmTarget?.action === "delete"}
        onConfirm={() => {
          if (!confirmTarget) return;
          if (confirmTarget.action === "archive") void archiveProject(confirmTarget.project);
          else void deleteProject(confirmTarget.project);
        }}
        onClose={() => setConfirmTarget(null)}
      />

    </div>
  );
}

function ProjectCardView({
  title,
  count,
  previews,
  accent,
  href,
  meta,
  disabledReason,
  onDisabledClick,
  onOpen,
  children,
}: {
  title: string;
  count: number;
  previews: string[];
  accent: string;
  href: string;
  /** Extra status line under the file count. */
  meta?: string | null;
  /** Set when the card must NOT navigate — an archived project's canvas
   *  redirects home, so a link there is a door into a wall. The reason becomes
   *  the card's tooltip and the click says the same thing out loud. */
  disabledReason?: string | null;
  onDisabledClick?: () => void;
  onOpen?: () => void;
  children?: React.ReactNode;
}) {
  const extra = count - previews.length;
  const inner = (
    <>
        <div style={{ position: "relative", height: 122, background: "var(--bg-el)", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 1 }}>
          {previews.length === 0 && (
            <div style={{ gridColumn: "1 / 3", gridRow: "1 / 3", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tm)", fontSize: 11 }}>
              No files yet
            </div>
          )}
          {previews.slice(0, 4).map((src, i) => (
            <div
              key={i}
              style={{
                position: "relative",
                gridColumn: previews.length === 1 ? "1 / 3" : undefined,
                gridRow: previews.length === 1 ? "1 / 3" : undefined,
                backgroundImage: `url(${src})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            >
              {i === 3 && extra > 0 && (
                <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>
                  +{extra}
                </div>
              )}
            </div>
          ))}
          <span style={{ position: "absolute", top: 8, left: 8, width: 8, height: 8, borderRadius: 999, background: accent }} />
        </div>
        <div style={{ padding: "10px 12px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {title}
        </div>
          <div style={{ fontSize: 11, color: "var(--t2)", marginTop: 2 }}>
            {count} {count === 1 ? "file" : "files"}
            {meta && <span style={{ color: "var(--t2b)" }}> · {meta}</span>}
          </div>
        </div>
    </>
  );

  const surface: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    textAlign: "left",
    background: "var(--bg-s)",
    border: "1px solid var(--bd)",
    borderRadius: 3,
    overflow: "hidden",
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
    color: "inherit",
    textDecoration: "none",
  };

  return (
    <div style={{ position: "relative" }}>
      {disabledReason ? (
        <div
          role="button"
          tabIndex={0}
          title={disabledReason}
          onClick={onDisabledClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onDisabledClick?.();
          }}
          style={{ ...surface, cursor: "default" }}
        >
          {inner}
        </div>
      ) : (
        <Link
          href={href}
          onNavigate={() => {
            onOpen?.();
            navProgressStart();
          }}
          style={surface}
        >
          {inner}
        </Link>
      )}
      {children}
    </div>
  );
}

function CardMenu({
  restoreOnly,
  onOpen,
  onRename,
  onArchive,
  onDelete,
  onRestore,
}: {
  restoreOnly: boolean;
  onOpen: () => void;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Project options"
        style={{ display: "flex", width: 24, height: 24, alignItems: "center", justifyContent: "center", background: "rgba(10,10,10,.55)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 2, color: "#fff", cursor: "pointer" }}
      >
        <MoreIcon width={13} height={13} />
      </button>
      {open && (
        <>
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }}
            style={{ position: "fixed", inset: 0, zIndex: Z.menuBackdrop }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ position: "absolute", top: 28, right: 0, width: 150, background: "rgba(18,18,18,.97)", border: "1px solid var(--bd)", borderRadius: 2, backdropFilter: "blur(20px)", boxShadow: "0 20px 60px rgba(0,0,0,.7)", zIndex: Z.menu, padding: 6 }}
          >
            <MenuBtn label="Open" onClick={() => { setOpen(false); onOpen(); }} />
            {restoreOnly ? (
              <MenuBtn label="Restore" onClick={() => { setOpen(false); onRestore(); }} />
            ) : (
              <>
                <MenuBtn label="Rename" onClick={() => { setOpen(false); onRename(); }} />
                <MenuBtn label="Archive" onClick={() => { setOpen(false); onArchive(); }} />
                <MenuBtn label="Delete" danger onClick={() => { setOpen(false); onDelete(); }} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      style={{ display: "flex", width: "100%", padding: "8px 10px", border: 0, borderRadius: 2, cursor: "pointer", fontFamily: "inherit", color: danger ? "var(--red)" : "var(--t2)", fontSize: 12.5, background: "transparent", textAlign: "left" }}
    >
      {label}
    </button>
  );
}

function NavItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const style: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    padding: "8px 8px",
    background: active ? "var(--bg-el)" : "transparent",
    border: 0,
    borderRadius: 2,
    color: active ? "var(--t1)" : "var(--t2)",
    fontSize: 13,
    fontFamily: "inherit",
    textDecoration: "none",
    cursor: onClick ? "pointer" : undefined,
  };
  return (
    <button onClick={onClick} style={style}>
      <span style={{ display: "flex", flex: "0 0 auto" }}>{icon}</span>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
    </button>
  );
}

/* icons (inline, match the mono/line style) */
const iconProps = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const GridIcon = () => (<svg {...iconProps}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
