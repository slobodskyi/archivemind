import { NextResponse } from "next/server";
import type { TrashedAssetsResponse } from "@archivemind/shared";
import { createClient } from "@/lib/supabase/server";
import { getTrashedAssets } from "@/lib/assets";

/** GET /api/assets?scope=trash — the photo half of the Trash view (ADR 0033).
 *  Trash only: active assets reach the client through Server Components
 *  (lib/api.ts getPhotos), and HTTP is the client seam — the Trash view is a
 *  client fetch exactly like /api/projects?scope=trash. */
export async function GET(request: Request) {
  const scope = new URL(request.url).searchParams.get("scope");
  if (scope !== "trash") {
    return NextResponse.json({ error: "unsupported scope" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const assets = await getTrashedAssets(supabase);
    const body: TrashedAssetsResponse = { assets };
    return NextResponse.json(body);
  } catch (err) {
    console.error("assets trash listing failed:", err);
    return NextResponse.json({ error: "trash listing failed" }, { status: 500 });
  }
}
