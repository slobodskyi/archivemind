"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createProjectResponseSchema,
  TRASH_RETENTION_DAYS,
  type TrashedAsset,
} from "@archivemind/shared";
import type { ProjectCard } from "@/lib/projects";
import Toast from "@/components/modals/Toast";
import DataSourcesModal from "@/components/modals/DataSourcesModal";
import { useGdriveConnection } from "@/hooks/useGdriveConnection";
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
  MoreIcon,
  LogsIcon,
  HelpIcon,
  PrivacyIcon,
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
  trash: "Trash is empty — deleted projects and photos stay here for 30 days before they're removed for good.",
};

/** Whole days until the sweep claims something deleted at `deletedAt`; null
 *  when the timestamp is missing (pre-migration rows) or unparseable. */
function daysLeft(deletedAt: string | null | undefined): number | null {
  if (!deletedAt) return null;
  const t = new Date(deletedAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - (Date.now() - t) / 86_400_000));
}

function daysLeftLabel(deletedAt: string | null | undefined): string | null {
  const d = daysLeft(deletedAt);
  if (d == null) return null;
  if (d === 0) return "removal due";
  return d === 1 ? "1 day left" : `${d} days left`;
}

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [activeProjects, setActiveProjects] = useState<ProjectCard[]>(projects);
  const [archivedProjects, setArchivedProjects] = useState<ProjectCard[] | null>(null);
  const [trashProjects, setTrashProjects] = useState<ProjectCard[] | null>(null);
  const [trashAssets, setTrashAssets] = useState<TrashedAsset[] | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectCard | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ project: ProjectCard; action: "archive" | "delete" } | null>(null);
  /** Pending "delete photos permanently" confirmation (ADR 0033). */
  const [purgeTarget, setPurgeTarget] = useState<{ ids: string[]; emptyAll: boolean } | null>(null);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 3200); // same duration as the workspace toast
  };

  // Shared gdrive lifecycle (also drives the ImportModal pane) — ADR 0025.
  const {
    gdrive,
    refresh: refreshGdrive,
    connect: connectGdrive,
    disconnect: disconnectGdrive,
  } = useGdriveConnection(flash);

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
    void fetch("/api/assets?scope=trash")
      .then((resp) => (resp.ok ? resp.json() : { assets: [] }))
      .then(({ assets }) => setTrashAssets(assets as TrashedAsset[]))
      .catch(() => setTrashAssets([]));
  };

  async function restoreAssets(ids: string[]) {
    try {
      const resp = await fetch("/api/assets/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      setTrashAssets((l) => (l ? l.filter((a) => !ids.includes(a.id)) : l));
      flash(ids.length === 1 ? "Photo restored" : `${ids.length} photos restored`);
    } catch {
      flash("Could not restore — try again");
    }
  }

  async function purgeAssets(ids: string[]) {
    setPurgeTarget(null);
    try {
      const resp = await fetch("/api/assets/purge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!resp.ok) throw new Error(String(resp.status));
      setTrashAssets((l) => (l ? l.filter((a) => !ids.includes(a.id)) : l));
      flash(ids.length === 1 ? "Photo deleted permanently" : `${ids.length} photos deleted permanently`);
    } catch {
      flash("Could not delete — try again");
    }
  }

  const baseList = view === "recents"
    ? (recentIds.map((id) => activeProjects.find((p) => p.id === id)).filter(Boolean) as ProjectCard[])
    : view === "projects"
      ? activeProjects
      : view === "archived"
        ? (archivedProjects ?? [])
        : (trashProjects ?? []);

  const q = query.trim().toLowerCase();
  const visibleProjects = q ? baseList.filter((p) => p.name.toLowerCase().includes(q)) : baseList;
  const visibleTrashAssets =
    view === "trash"
      ? (trashAssets ?? []).filter((a) => !q || a.name.toLowerCase().includes(q))
      : [];

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
    <div style={{ position: "relative", display: "flex", width: "100vw", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
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
          <NavItem label="Logs" icon={<LogsIcon />} onClick={() => flash("Activity log coming soon")} />
          <NavItem label="Help" icon={<HelpIcon />} onClick={() => setHelpOpen(true)} />
          <NavItem label="Privacy Policy" icon={<PrivacyIcon />} onClick={() => flash("Privacy Policy coming soon")} />
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
              meta={view === "trash" ? daysLeftLabel(p.deletedAt) : null}
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

        {/* Trashed PHOTOS (ADR 0033) — the asset half of the Trash: restore or
            permanently delete individual photos, or empty the lot. Projects
            above keep their own lifecycle; "Empty trash" is photos-only. */}
        {view === "trash" && visibleTrashAssets.length > 0 && (
          <section style={{ marginTop: visibleProjects.length > 0 ? 30 : 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--t1)", margin: 0 }}>
                Photos <span style={{ color: "var(--tm)", fontWeight: 400 }}>({visibleTrashAssets.length})</span>
              </h2>
              <button
                onClick={() => setPurgeTarget({ ids: (trashAssets ?? []).map((a) => a.id), emptyAll: true })}
                style={{ height: 28, padding: "0 12px", background: "transparent", color: "var(--red)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 11.5, fontWeight: 700, letterSpacing: ".03em", cursor: "pointer", fontFamily: "inherit" }}
              >
                Empty trash
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {visibleTrashAssets.map((a) => (
                <TrashedPhotoCard
                  key={a.id}
                  asset={a}
                  onRestore={() => void restoreAssets([a.id])}
                  onPurge={() => setPurgeTarget({ ids: [a.id], emptyAll: false })}
                />
              ))}
            </div>
          </section>
        )}

        {visibleProjects.length === 0 &&
          visibleTrashAssets.length === 0 &&
          !((view === "projects" || view === "recents") && creating) && (
          <div style={{ marginTop: 26, fontSize: 12.5, color: "var(--tm)" }}>
            {q ? "Nothing matches your search." : VIEW_EMPTY[view]}
          </div>
        )}
      </main>

      <UploadManager projectId="all" disabled disabledMessage="OPEN A PROJECT TO UPLOAD" />

      <Toast show={!!toast} text={toast ?? ""} />

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

      {/* Permanent photo deletion (ADR 0033) — the one action in the app that
          truly cannot be undone, so it always confirms, even for one photo. */}
      <ConfirmModal
        open={!!purgeTarget}
        title={purgeTarget?.emptyAll ? "Empty trash?" : "Delete permanently?"}
        body={
          purgeTarget?.emptyAll
            ? `All ${purgeTarget.ids.length} trashed photos will be permanently deleted, including their previews and AI data. This cannot be undone.`
            : "This photo will be permanently deleted, including its previews and AI data. This cannot be undone."
        }
        confirmLabel="Delete permanently"
        danger
        onConfirm={() => purgeTarget && void purgeAssets(purgeTarget.ids)}
        onClose={() => setPurgeTarget(null)}
      />
    </div>
  );
}

function TrashedPhotoCard({
  asset,
  onRestore,
  onPurge,
}: {
  asset: TrashedAsset;
  onRestore: () => void;
  onPurge: () => void;
}) {
  const left = daysLeftLabel(asset.deletedAt);
  return (
    <div style={{ background: "var(--bg-s)", border: "1px solid var(--bd)", borderRadius: 3, overflow: "hidden" }}>
      <div
        style={{
          height: 96,
          background: asset.thumb ? `url(${asset.thumb}) center/cover` : "var(--bg-el)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!asset.thumb && <span style={{ color: "var(--tm)", fontSize: 10.5 }}>No preview</span>}
      </div>
      <div style={{ padding: "8px 10px" }}>
        <div style={{ fontSize: 11.5, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={asset.name}>
          {asset.name}
        </div>
        {left && <div style={{ fontSize: 10.5, color: "var(--tm)", marginTop: 2 }}>{left}</div>}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <button
            onClick={onRestore}
            style={{ flex: 1, height: 24, background: "var(--bg-el)", color: "var(--t1)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 10.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            Restore
          </button>
          <button
            onClick={onPurge}
            aria-label={`Delete ${asset.name} permanently`}
            title="Delete permanently"
            style={{ flex: "0 0 auto", height: 24, padding: "0 8px", background: "transparent", color: "var(--red)", border: "1px solid var(--bd)", borderRadius: 2, fontSize: 10.5, cursor: "pointer", fontFamily: "inherit" }}
          >
            <TrashIcon width={11} height={11} />
          </button>
        </div>
      </div>
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
  onOpen,
  children,
}: {
  title: string;
  count: number;
  previews: string[];
  accent: string;
  href: string;
  /** Extra status line (e.g. the Trash view's "N days left" countdown). */
  meta?: string | null;
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
            {meta && <span style={{ color: "var(--t3)" }}> · {meta}</span>}
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
