import { resolveProjectShareMedia } from "@/lib/integrations/project-shares.server";
import { projectShareMediaVariantSchema } from "@/lib/project-share-public";
import { SHARE_PRESIGN_TTL_SECONDS, shareNotFound, shareRedirect } from "@/lib/project-share-http";
import { presignGet } from "@/lib/r2";

interface RouteContext {
  params: Promise<{ token: string; assetId: string; variant: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /s/{token}/media/{assetId}/{thumb|medium|original} (ADR 0051 §7).
 *
 *  The token and the asset's membership in the link's project are re-checked
 *  on every request, then the answer is a 302 to a 5-minute presigned R2 URL:
 *  originals reach 100 MiB, and those bytes must not cross a Vercel function.
 *  No signature is ever embedded in the page, so turning a link off stops the
 *  next request; what is left is the tail of a URL already handed out. A file
 *  (original or its web-size stand-in) is signed as an attachment. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { token, assetId, variant } = await params;
  const parsedVariant = projectShareMediaVariantSchema.safeParse(variant);
  if (!parsedVariant.success) return shareNotFound();

  try {
    const media = await resolveProjectShareMedia(token, assetId, parsedVariant.data);
    if (!media) return shareNotFound();
    const url = await presignGet(
      media.key,
      media.quality === "preview" ? undefined : media.filename,
      { ttlSeconds: SHARE_PRESIGN_TTL_SECONDS },
    );
    return shareRedirect(url, SHARE_PRESIGN_TTL_SECONDS - 60);
  } catch (err) {
    console.error("project share media:", err instanceof Error ? err.message : err);
    return shareNotFound();
  }
}
