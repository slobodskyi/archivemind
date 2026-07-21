"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectResponseSchema, googleConnectionStatusSchema } from "@archivemind/shared";
import type { ProjectCard } from "@/lib/projects";
import Toast from "@/components/modals/Toast";
import DataSourcesModal, { type GdriveConnectionState } from "@/components/modals/DataSourcesModal";
import { requestDriveCode, DriveAuthError } from "@/lib/google-identity";
import { driveErrorMessage } from "@/lib/drive-errors";
import RenameModal from "@/components/modals/RenameModal";
import ConfirmModal from "@/components/modals/ConfirmModal";
import AccountMenu from "@/components/home/AccountMenu";
import { navProgressStart } from "@/components/nav/TopProgressBar";
import UploadManager from "@/components/upload/UploadManager";
import { Z } from "@/lib/ui";
import {
  SearchIcon,
  DataSourcesIcon,
  RecentsIcon,
  ArchiveIcon,
  TrashIcon,
  UpgradeIcon,
  MoreIcon,
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

type ViewMode = "projects" | "recents" | "archived" | "trash";

const VIEW_TITLE: Record<ViewMode, string> = {
  projects: "Projects",
  recents: "Recents",
  archived: "Archived",
  trash: "Trash",
};

const VIEW_EMPTY: Record<ViewMode, string> = {
  projects: "No projects yet — create one to group photos from your archive.",
  recents: "No recently opened projects yet.",
  archived: "No archived projects — archive a project to tuck it away without deleting it.",
  trash: "Trash is empty — deleted projects stay here for 30 days before they're removed for good.",
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
}: {
  account: Account;
  projects: ProjectCard[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("projects");
  const [query, setQuery] = useState("");
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [gdrive, setGdrive] = useState<GdriveConnectionState>({
    connected: false,
    email: null,
    busy: false,
  });
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeProjects, setActiveProjects] = useState<ProjectCard[]>(projects);
  const [archivedProjects, setArchivedProjects] = useState<ProjectCard[] | null>(null);
  const [trashProjects, setTrashProjects] = useState<ProjectCard[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectCard | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ project: ProjectCard; action: "archive" | "delete" } | null>(null);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 3200); // same duration as the workspace toast
  };

  /** Refresh the caller's gdrive connection state (fired on modal open — the
   *  modal renders instantly from the last known state, then corrects). */
  const refreshGdrive = async () => {
    try {
      const res = await fetch("/api/integrations/google");
      if (!res.ok) return;
      const parsed = googleConnectionStatusSchema.safeParse(await res.json());
      if (!parsed.success) return;
      // busy-guard: a slow GET must never overwrite the outcome of a connect/
      // disconnect that finished while it was in flight.
      setGdrive((g) =>
        g.busy ? g : { ...g, connected: parsed.data.connected, email: parsed.data.email },
      );
    } catch {
      // Status is cosmetic here; connect/disconnect surface their own errors.
    }
  };

  const connectGdrive = async () => {
    setGdrive((g) => ({ ...g, busy: true }));
    try {
      const code = await requestDriveCode();
      const res = await fetch("/api/integrations/google/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const raw: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = raw as { error?: unknown };
        return flash(driveErrorMessage(err.error));
      }
      const parsed = googleConnectionStatusSchema.safeParse(raw);
      const email = parsed.success ? parsed.data.email : null;
      setGdrive((g) => ({ ...g, connected: true, email }));
      flash(email ? `Google Drive connected as ${email}` : "Google Drive connected");
    } catch (err) {
      // DriveAuthError carries a first-party code; anything else → generic copy.
      flash(driveErrorMessage(err instanceof DriveAuthError ? err.code : undefined));
    } finally {
      setGdrive((g) => ({ ...g, busy: false }));
    }
  };

  const disconnectGdrive = async () => {
    setGdrive((g) => ({ ...g, busy: true }));
    try {
      const res = await fetch("/api/integrations/google", { method: "DELETE" });
      const body: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) return flash(driveErrorMessage(body.error ?? "drive_disconnect_failed"));
      setGdrive((g) => ({ ...g, connected: false, email: null }));
      flash("Google Drive disconnected");
    } catch {
      flash(driveErrorMessage("drive_disconnect_failed"));
    } finally {
      setGdrive((g) => ({ ...g, busy: false }));
    }
  };

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

  const openArchived = () => {
    setView("archived");
    void fetchScope("archived").then(setArchivedProjects);
  };

  const openTrash = () => {
    setView("trash");
    void fetchScope("trash").then(setTrashProjects);
  };

  const baseList = view === "recents"
    ? (recentIds.map((id) => activeProjects.find((p) => p.id === id)).filter(Boolean) as ProjectCard[])
    : view === "projects"
      ? activeProjects
      : view === "archived"
        ? (archivedProjects ?? [])
        : (trashProjects ?? []);

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
    setTrashProjects((l) => (l ? applyName(l) : l));
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
    setTrashProjects((l) => (l ? [project, ...l] : l));
    flash(`"${project.name}" moved to Trash`);
  }

  async function restoreProject(project: ProjectCard, from: "archived" | "trash") {
    const ok = await patchProject(project.id, from === "archived" ? { archived: false } : { deleted: false });
    if (!ok) return flash("Could not restore — try again");
    if (from === "archived") setArchivedProjects((l) => (l ? l.filter((p) => p.id !== project.id) : l));
    else setTrashProjects((l) => (l ? l.filter((p) => p.id !== project.id) : l));
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
    <div style={{ display: "flex", width: "100vw", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      {/* ── drawer sidebar ─────────────────────────────────────────── */}
      <aside
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

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem label="Projects" active={view === "projects"} icon={<GridIcon />} onClick={() => setView("projects")} />
          <NavItem label="Recents" active={view === "recents"} icon={<RecentsIcon />} onClick={openRecents} />
        </nav>

        <div style={{ flex: 1 }} />

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem label="Upgrade" icon={<UpgradeIcon />} onClick={() => flash("Upgrade plans — coming soon")} />
          <NavItem label="Archived" active={view === "archived"} icon={<ArchiveIcon />} onClick={openArchived} />
          <NavItem label="Trash" active={view === "trash"} icon={<TrashIcon />} onClick={openTrash} />
        </nav>
      </aside>

      {/* ── content: project cards ─────────────────────────────────── */}
      <main style={{ flex: 1, height: "100%", overflowY: "auto", padding: "26px 30px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
          <h1 style={{ fontSize: 19, fontWeight: 700, color: "var(--t1)", margin: 0 }}>{VIEW_TITLE[view]}</h1>
          {(view === "projects" || view === "recents") && !creating && (
            <button
              onClick={() => setCreating(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer", fontFamily: "inherit" }}
            >
              + New project
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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
          {visibleProjects.map((p) => (
            <ProjectCardView
              key={p.id}
              title={p.name}
              count={p.count}
              previews={p.previews}
              accent={cardColor(p.id)}
              href={`/projects/${p.id}`}
              onOpen={() => recordRecentProject(p.id)}
            >
              <CardMenu
                restoreOnly={view === "archived" || view === "trash"}
                onOpen={() => openProject(p.id)}
                onRename={() => setRenameTarget(p)}
                onArchive={() => setConfirmTarget({ project: p, action: "archive" })}
                onDelete={() => setConfirmTarget({ project: p, action: "delete" })}
                onRestore={() => restoreProject(p, view === "archived" ? "archived" : "trash")}
              />
            </ProjectCardView>
          ))}
        </div>

        {visibleProjects.length === 0 && !((view === "projects" || view === "recents") && creating) && (
          <div style={{ marginTop: 26, fontSize: 12.5, color: "var(--tm)" }}>
            {q ? "No projects match your search." : VIEW_EMPTY[view]}
          </div>
        )}
      </main>

      <UploadManager projectId="all" disabled disabledMessage="OPEN A PROJECT TO UPLOAD" />

      <Toast show={!!toast} text={toast ?? ""} />

      <DataSourcesModal
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        onConnect={(name) => {
          setSourcesOpen(false);
          flash(`${name} — connect flow coming soon`);
        }}
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
  onOpen,
  children,
}: {
  title: string;
  count: number;
  previews: string[];
  accent: string;
  href: string;
  onOpen?: () => void;
  children?: React.ReactNode;
}) {
  const extra = count - previews.length;
  return (
    <div style={{ position: "relative" }}>
      <Link
        href={href}
        onNavigate={() => {
          onOpen?.();
          navProgressStart();
        }}
        style={{
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
        }}
      >
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
          <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
            {count} {count === 1 ? "file" : "files"}
          </div>
        </div>
      </Link>
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
