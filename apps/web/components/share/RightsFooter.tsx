import type { ReactNode } from "react";
import type { PublicationRights } from "@/lib/publication-shares";

/** `2026-11-03T…` → `3 Nov 2026`, by string, so the server render and the
 *  browser can never disagree about the day (no time zone is involved). */
export function formatShareDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[Number(match[2]) - 1];
  return month ? `${Number(match[3])} ${month} ${match[1]}` : value;
}

/** The owner's byline under anything shared without an account — a
 *  publication (ADR 0046) or a project link (ADR 0051). It is the workspace's
 *  credit block, the same one the PDF and the ZIP's README carry, so the
 *  person holding the link is told who made the work and on what terms. */
export default function RightsFooter({
  rights,
  sharedAt = null,
  expiresAt,
}: {
  rights: PublicationRights;
  sharedAt?: string | null;
  expiresAt: string | null;
}) {
  const terms: ReactNode[] = [];
  if (rights.creator) terms.push(<span key="creator">Created by {rights.creator}</span>);
  if (rights.credit) terms.push(<span key="credit">Credit: {rights.credit}</span>);
  if (rights.copyrightNotice) terms.push(<span key="copyright">{rights.copyrightNotice}</span>);
  if (rights.usageTerms) terms.push(<span key="terms">Usage: {rights.usageTerms}</span>);
  return (
    <footer className="public-share-footer">
      <div>
        {sharedAt ? <span>Shared {formatShareDate(sharedAt)}</span> : null}
        {expiresAt ? <span>Link available until {formatShareDate(expiresAt)}</span> : null}
      </div>
      {terms.length ? <div>{terms}</div> : null}
    </footer>
  );
}
