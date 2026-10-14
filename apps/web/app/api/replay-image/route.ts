import { NextResponse } from "next/server";
import { presignGet, r2Bucket } from "@/lib/r2";
import { verifyReplayImageRequest } from "@/lib/replay-image";

/** GET /api/replay-image?p=<R2 path>&t=<token> — a photo for PostHog's replay
 *  player (ADR 0050 amendment). Public in proxy.ts on purpose: the player is
 *  on PostHog's origin and sends no session cookie, so the HMAC token is the
 *  whole authorisation. It opens preview derivatives of one workspace only.
 *
 *  Redirects rather than streams: the bytes go straight from R2 to the
 *  player, and this function never holds an image in memory. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const key = verifyReplayImageRequest(params.get("p"), params.get("t"), r2Bucket());
  if (!key) return new NextResponse(null, { status: 404 });

  const res = NextResponse.redirect(await presignGet(key), 302);
  // The target lives 30–60 min; a short private cache stops a scrubbing
  // player from minting a signature per frame.
  res.headers.set("Cache-Control", "private, max-age=600");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
