/** Open-redirect guard for caller-supplied post-auth targets (`?next=`).
 *
 *  An auth callback is a trusted origin, so an unvalidated `next` lets an
 *  attacker bounce a freshly-signed-in user off-site (`?next=//evil.com` or
 *  `?next=https://evil.com`) with our domain in the referrer. Only a
 *  same-origin absolute path survives: one leading "/", no scheme, and no
 *  protocol-relative form.
 *
 *  Pass the request's own base — `request.nextUrl` is the convenient one. Note
 *  it resolves to the same host as `request.url`: NextRequest builds the latter
 *  from the former, and neither consults `x-forwarded-host`. So this guard is
 *  about the *path*, not about trusting a host.
 */
export function safeNextUrl(next: string | null | undefined, base: string | URL): URL {
  const baseUrl = new URL(base.toString());
  const fallback = new URL("/", baseUrl);
  if (!next) return fallback;

  // The URL parser silently drops tab/newline, so "/\t/evil.com" would reach a
  // browser as "//evil.com". Strip them before deciding, not after.
  const candidate = next.replace(/[\t\n\r]/g, "");

  // Must be an absolute path: rules out "https://evil.com" and "evil.com".
  if (!candidate.startsWith("/")) return fallback;
  // "//host" is protocol-relative; browsers read the backslash form as the same.
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return fallback;

  const resolved = new URL(candidate, baseUrl);
  // Belt and braces — a path reference can't change origin, but assert it anyway.
  return resolved.origin === baseUrl.origin ? resolved : fallback;
}
