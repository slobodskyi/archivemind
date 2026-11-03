/** Response helpers for the public `/s/{token}/…` routes (ADR 0051). Every
 *  refusal — malformed, unknown, revoked, expired, an upload-only link asking
 *  for files, an asset from another project — is this one 404, so no answer
 *  tells a stranger which of those it was. */

export const SHARE_PRESIGN_TTL_SECONDS = 5 * 60;

const baseHeaders = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive, noimageindex",
};

export const noStoreHeaders = {
  ...baseHeaders,
  "Cache-Control": "private, no-store, max-age=0",
};

export function shareNotFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404, headers: noStoreHeaders });
}

export function shareJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: noStoreHeaders });
}

/** A 302 to a short presigned R2 URL. `maxAge` lets the browser reuse the
 *  redirect for a little less than the signature lives, so a grid of
 *  thumbnails is not re-signed on every scroll — and never longer, so a cached
 *  redirect cannot outlive its URL. */
export function shareRedirect(location: string, maxAge: number | null): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...baseHeaders,
      Location: location,
      "Cache-Control": maxAge === null ? noStoreHeaders["Cache-Control"] : `private, max-age=${maxAge}`,
    },
  });
}
