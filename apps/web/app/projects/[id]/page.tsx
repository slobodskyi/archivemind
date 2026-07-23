import { redirect } from "next/navigation";
import ArchiveWorkspace from "@/components/workspace/ArchiveWorkspace";
import { getPhotos } from "@/lib/api";
import { ensureWorkspace } from "@/lib/bootstrap";
import { getCanvasGroups } from "@/lib/canvas-groups";
import { getProjectCards } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";

/** Canvas route (issue #17): a project and its M:N assets. The legacy `all`
 *  scope remains a read-only recovery grid for unassigned uploads. */
export default async function ProjectCanvas({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // Next 16: params is a Promise

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/reset");

  // Parallel: ensureWorkspace is idempotent bootstrap, and getPhotos reuses
  // this page's client (skipping its internal re-auth) — the canvas load drops
  // from four sequential round trips to two.
  const [workspaceId, photos, projectCards, groups] = await Promise.all([
    ensureWorkspace(supabase, user),
    getPhotos(id, supabase),
    getProjectCards(supabase),
    getCanvasGroups(supabase, id),
  ]);
  const projects = projectCards.map((p) => ({ id: p.id, name: p.name, count: p.count }));

  // Guard: an unknown project id (deleted, or not the caller's) → home.
  if (id !== "all" && !projects.some((p) => p.id === id)) redirect("/");

  return (
    <ArchiveWorkspace
      key={`ws-${id}`}
      initialPhotos={photos}
      workspaceId={workspaceId}
      projects={projects}
      currentProjectId={id}
      initialGroups={groups}
    />
  );
}
