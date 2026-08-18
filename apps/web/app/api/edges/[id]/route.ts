import { NextResponse } from "next/server";
import { uuidSchema } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";

/** DELETE /api/edges/[id] — remove one connection. The only mutation an edge
 *  supports: it is immutable (ADR 0048), so there is no PATCH here and never
 *  will be — re-drawing is the edit. RLS scopes the delete to the caller's
 *  workspace; a foreign id matches nothing and returns ok, the same
 *  no-existence-oracle shape as /api/annotations/[id]. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await context.params;
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { error } = await supabase.from("canvas_edges").delete().eq("id", parsed.data);
  if (error?.code === "42P01") {
    return NextResponse.json({ error: "edges are not available yet" }, { status: 503 });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
