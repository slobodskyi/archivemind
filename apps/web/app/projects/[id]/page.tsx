import { redirect } from "next/navigation";
import UploadManager from "@/components/upload/UploadManager";
import ArchiveWorkspace from "@/components/workspace/ArchiveWorkspace";
import { getPhotos } from "@/lib/api";
import { ensureWorkspace } from "@/lib/bootstrap";
import { getProjectCards } from "@/lib/projects";
import { createClient } from "@/lib/supabase/server";

/** Canvas route (issue #17): `id === "all"` → the whole workspace; otherwise a
 *  single project's M:N assets. The header/dropdown navigate between these. */
export default async function ProjectCanvas({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; // Next 16: params is a Promise

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/reset");

  const workspaceId = await ensureWorkspace(supabase, user);

  const [photos, projectCards] = await Promise.all([
    getPhotos(id),
    getProjectCards(supabase),
  ]);
  const projects = projectCards.map((p) => ({ id: p.id, name: p.name, count: p.count }));

  // Guard: an unknown project id (deleted, or not the caller's) → home.
  if (id !== "all" && !projects.some((p) => p.id === id)) redirect("/");

  const processedCount = photos.filter((p) => p.processed).length;

  return (
    <>
      <ArchiveWorkspace
        key={`ws-${id}-${photos.length}-${processedCount}`}
        initialPhotos={photos}
        workspaceId={workspaceId}
        projects={projects}
        currentProjectId={id}
      />
      <UploadManager />
    </>
  );
}
