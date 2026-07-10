import { redirect } from "next/navigation";
import UploadManager from "@/components/upload/UploadManager";
import ArchiveWorkspace from "@/components/workspace/ArchiveWorkspace";
import { getPhotos } from "@/lib/api";
import { ensureWorkspace } from "@/lib/bootstrap";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // proxy.ts passed a signature-valid JWT, but the user may no longer exist
  // (deleted account, wiped dev DB). /auth/reset clears the dead cookies —
  // redirecting to /login directly would loop (proxy bounces authed → /).
  if (!user) redirect("/auth/reset");

  const workspaceId = await ensureWorkspace(supabase, user);

  // Real assets (issue #6). Keyed by count + processed-count: router.refresh()
  // after an upload OR a finished analyze remounts the workspace so fresh
  // server data replaces the client copy useWorkspace keeps in state.
  const photos = await getPhotos();
  const processedCount = photos.filter((p) => p.processed).length;
  const captionCount = photos.reduce((n, p) => n + Object.keys(p.captionTexts ?? {}).length, 0);
  return (
    <>
      <ArchiveWorkspace
        key={`ws-${photos.length}-${processedCount}-${captionCount}`}
        initialPhotos={photos}
        workspaceId={workspaceId}
      />
      <UploadManager />
    </>
  );
}
