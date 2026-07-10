import { NextResponse } from "next/server";
import { presignUploadRequestSchema, type PresignUploadResponse } from "@archivemind/shared";
import { originalKey, presignPut } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspaceId } from "@/lib/workspace";

/** POST /api/uploads/presign (spec §9): {filename,mime,size} → {uploadUrl,r2Key}.
 *  Single presigned PUT ≤ 100 MiB; multipart for larger files is a Phase-1
 *  follow-up (the shared schema already rejects oversize with a clean 400). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const workspaceId = await getCurrentWorkspaceId(supabase);
  if (!workspaceId) return NextResponse.json({ error: "no workspace" }, { status: 403 });

  const parsed = presignUploadRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const r2Key = originalKey(workspaceId, parsed.data.filename);
  const uploadUrl = await presignPut(r2Key, parsed.data.mime);
  const body: PresignUploadResponse = { uploadUrl, r2Key };
  return NextResponse.json(body);
}
