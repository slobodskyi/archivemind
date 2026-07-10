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

  await ensureWorkspace(supabase, user);

  // Canvas data stays mock until Phase 1 swaps the lib/api.ts seam (issue #6).
  const photos = await getPhotos();
  return (
    <>
      <ArchiveWorkspace initialPhotos={photos} />
      <UploadManager />
    </>
  );
}
