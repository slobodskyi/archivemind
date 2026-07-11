"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectResponseSchema } from "@archivemind/shared";
import type { ProjectCard } from "@/lib/projects";
import UploadManager, { OPEN_UPLOAD_EVENT } from "@/components/upload/UploadManager";

/** Homepage hub (issue #17): drawer sidebar + project cards. Projects are
 *  real (Supabase); local upload works; cloud sources are "coming soon" until
 *  Phase 6. Opening a project navigates to its canvas at /projects/[id]. */

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

export default function HomeClient({
  account,
  projects,
  allCount,
}: {
  account: Account;
  projects: ProjectCard[];
  allCount: number;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(null), 2600);
  };

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
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--t1)", letterSpacing: "0.04em", padding: "0 8px 18px" }}>
          ArchiveMind
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem label="Projects" active icon={<GridIcon />} />
          <NavItem label="All my files" count={allCount} icon={<FilesIcon />} onClick={() => router.push("/projects/all")} />
        </nav>

        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--tm)", padding: "20px 8px 8px" }}>
          Sources
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <NavItem label="Local upload" icon={<UploadIcon />} onClick={() => window.dispatchEvent(new Event(OPEN_UPLOAD_EVENT))} />
          <NavItem label="Google Drive" muted icon={<CloudIcon />} onClick={() => flash("Google Drive — coming soon")} />
          <NavItem label="Dropbox" muted icon={<CloudIcon />} onClick={() => flash("Dropbox — coming soon")} />
        </div>

        <div style={{ flex: 1 }} />

        {/* account block */}
        <div style={{ borderTop: "1px solid var(--bd)", paddingTop: 12, display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 2,
              background: "var(--bg-el)",
              border: "1px solid var(--bdh)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--t1)",
              fontSize: 11,
              fontWeight: 700,
              flex: "0 0 auto",
            }}
          >
            {account.initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {account.name}
            </div>
            <div style={{ fontSize: 10.5, color: "var(--tm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {account.email}
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              style={{ display: "flex", width: 26, height: 26, alignItems: "center", justifyContent: "center", border: 0, background: "transparent", color: "var(--t3)", cursor: "pointer", borderRadius: 2 }}
            >
              <SignOutIcon />
            </button>
          </form>
        </div>
      </aside>

      {/* ── content: project cards ─────────────────────────────────── */}
      <main style={{ flex: 1, height: "100%", overflowY: "auto", padding: "26px 30px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
          <h1 style={{ fontSize: 19, fontWeight: 600, color: "var(--t1)", margin: 0 }}>Projects</h1>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", background: "var(--ac)", color: "#050505", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, letterSpacing: ".04em", cursor: "pointer", fontFamily: "inherit" }}
            >
              + New project
            </button>
          )}
        </div>

        {creating && (
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
              style={{ padding: "0 16px", background: name.trim() ? "var(--ac)" : "var(--bg-el)", color: name.trim() ? "#050505" : "var(--tm)", border: 0, borderRadius: 2, fontSize: 12, fontWeight: 700, cursor: name.trim() ? "pointer" : "default", fontFamily: "inherit" }}
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
          {/* pinned: all files */}
          <ProjectCardView
            title="All my files"
            count={allCount}
            previews={[]}
            accent="var(--t3)"
            pinned
            onOpen={() => router.push("/projects/all")}
          />
          {projects.map((p) => (
            <ProjectCardView
              key={p.id}
              title={p.name}
              count={p.count}
              previews={p.previews}
              accent={cardColor(p.id)}
              onOpen={() => router.push(`/projects/${p.id}`)}
            />
          ))}
        </div>

        {projects.length === 0 && !creating && (
          <div style={{ marginTop: 26, fontSize: 12.5, color: "var(--tm)" }}>
            No projects yet — create one to group photos from your archive.
          </div>
        )}
      </main>

      <UploadManager />

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 95,
            background: "rgba(12,12,12,.97)",
            border: "1px solid var(--bd)",
            borderRadius: 2,
            padding: "9px 16px",
            fontSize: 12,
            color: "var(--t1)",
            backdropFilter: "blur(14px)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function ProjectCardView({
  title,
  count,
  previews,
  accent,
  pinned,
  onOpen,
}: {
  title: string;
  count: number;
  previews: string[];
  accent: string;
  pinned?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      style={{
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        background: "var(--bg-s)",
        border: `1px solid ${pinned ? "var(--bdh)" : "var(--bd)"}`,
        borderRadius: 3,
        overflow: "hidden",
        cursor: "pointer",
        fontFamily: "inherit",
        padding: 0,
      }}
    >
      <div style={{ position: "relative", height: 122, background: "var(--bg-el)", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 1 }}>
        {previews.length === 0 && (
          <div style={{ gridColumn: "1 / 3", gridRow: "1 / 3", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--tm)", fontSize: 11 }}>
            {pinned ? "Your whole archive" : "Empty"}
          </div>
        )}
        {previews.slice(0, 4).map((src, i) => (
          <div
            key={i}
            style={{
              gridColumn: previews.length === 1 ? "1 / 3" : undefined,
              gridRow: previews.length === 1 ? "1 / 3" : undefined,
              backgroundImage: `url(${src})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ))}
        <span style={{ position: "absolute", top: 8, left: 8, width: 8, height: 8, borderRadius: 999, background: accent }} />
      </div>
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
          {count} {count === 1 ? "file" : "files"}
        </div>
      </div>
    </button>
  );
}

function NavItem({
  label,
  count,
  icon,
  active,
  muted,
  onClick,
}: {
  label: string;
  count?: number;
  icon: React.ReactNode;
  active?: boolean;
  muted?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        width: "100%",
        padding: "8px 8px",
        background: active ? "var(--bg-el)" : "transparent",
        border: 0,
        borderRadius: 2,
        cursor: onClick ? "pointer" : "default",
        color: muted ? "var(--t3)" : active ? "var(--t1)" : "var(--t2)",
        fontSize: 13,
        fontFamily: "inherit",
      }}
    >
      <span style={{ display: "flex", flex: "0 0 auto" }}>{icon}</span>
      <span style={{ flex: 1, textAlign: "left" }}>{label}</span>
      {count != null && <span style={{ fontSize: 10.5, color: "var(--tm)" }}>{count}</span>}
    </button>
  );
}

/* icons (inline, match the mono/line style) */
const iconProps = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const GridIcon = () => (<svg {...iconProps}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
const FilesIcon = () => (<svg {...iconProps}><path d="M4 4h9l3 3v13H4z" /><path d="M13 4v3h3" /></svg>);
const UploadIcon = () => (<svg {...iconProps}><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 20h16" /></svg>);
const CloudIcon = () => (<svg {...iconProps}><path d="M6 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4 4 0 0 1 18 18z" /></svg>);
const SignOutIcon = () => (<svg {...iconProps}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>);
