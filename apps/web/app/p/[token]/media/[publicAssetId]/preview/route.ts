import { resolvePublicSharePreview } from "@/lib/publication-shares-server";

interface PublicPreviewRouteContext {
  params: Promise<{ token: string; publicAssetId: string }>;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, noarchive, noimageindex",
};

function notFoundResponse(): Response {
  return new Response("Not found", { status: 404, headers: privateHeaders });
}

/** Every rendered picture re-validates the bearer token at the moment the
 * browser asks for it, rather than carrying a signature minted when the page
 * was produced. The object is streamed through this route, which keeps lazy
 * images alive without exposing R2 and makes "turn off link" bite on the next
 * image request.
 * Unlike the sibling download route this ignores allow_downloads: showing a
 * publication is not the same permission as taking its files away. */
export async function GET(_request: Request, { params }: PublicPreviewRouteContext) {
  const { token, publicAssetId } = await params;
  try {
    const preview = await resolvePublicSharePreview(token, publicAssetId);
    if (!preview) return notFoundResponse();

    const headers = new Headers(privateHeaders);
    headers.set("Content-Disposition", "inline");
    headers.set("Content-Type", "image/webp");
    if (preview.contentLength !== null) {
      headers.set("Content-Length", String(preview.contentLength));
    }
    return new Response(preview.body, { status: 200, headers });
  } catch {
    return notFoundResponse();
  }
}
