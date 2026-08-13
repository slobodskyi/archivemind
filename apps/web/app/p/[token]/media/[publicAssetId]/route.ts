import { contentDisposition } from "@/lib/r2";
import { resolvePublicShareAsset } from "@/lib/publication-shares-server";

interface PublicAssetRouteContext {
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

const SAFE_DOWNLOAD_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);

function safeDownloadMimeType(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SAFE_DOWNLOAD_MIME_TYPES.has(normalized) ? normalized : "application/octet-stream";
}

function notFoundResponse(): Response {
  return new Response("Not found", { status: 404, headers: privateHeaders });
}

/** The bearer token and opaque public media id are re-validated on every
 * download. R2 is streamed through this same-origin route, so its host,
 * signature and durable object key never reach the browser. */
export async function GET(_request: Request, { params }: PublicAssetRouteContext) {
  const { token, publicAssetId } = await params;
  try {
    const asset = await resolvePublicShareAsset(token, publicAssetId);
    if (!asset) return notFoundResponse();

    const headers = new Headers(privateHeaders);
    headers.set("Content-Disposition", contentDisposition(asset.filename));
    headers.set("Content-Type", safeDownloadMimeType(asset.mimeType));
    if (asset.object.contentLength !== null) {
      headers.set("Content-Length", String(asset.object.contentLength));
    }
    return new Response(asset.object.body, { status: 200, headers });
  } catch {
    return notFoundResponse();
  }
}
