import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteObject } from "@/lib/r2";
import { createClient } from "@/lib/supabase/server";

const revokedRowSchema = z.object({
  id: z.string().uuid(),
  preview_r2_keys: z.array(z.string().min(1)).max(20),
});

/** DELETE revokes first, then best-effort removes immutable preview copies.
 * Once the RPC succeeds the link is already closed, even if R2 cleanup needs a
 * later retention retry. */
export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .rpc("revoke_publication_share", { p_share_id: id })
    .maybeSingle();
  if (error || !data) {
    if (error?.code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const revoked = revokedRowSchema.safeParse(data);
  if (!revoked.success) return NextResponse.json({ error: "revoke_failed" }, { status: 500 });

  const cleanup = await Promise.allSettled(revoked.data.preview_r2_keys.map((key) => deleteObject(key)));
  const cleanupPending = cleanup.some((result) => result.status === "rejected");
  if (cleanupPending) console.warn("publication share cleanup pending", { files: cleanup.length });
  return NextResponse.json({ revoked: true, cleanupPending }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
