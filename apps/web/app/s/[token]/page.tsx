import { connection } from "next/server";
import { notFound } from "next/navigation";
import ProjectShareFiles from "@/components/share/ProjectShareFiles";
import ProjectShareSendForm from "@/components/share/ProjectShareSendForm";
import RightsFooter, { formatShareDate } from "@/components/share/RightsFooter";
import { listProjectShareAssets, openProjectShare } from "@/lib/integrations/project-shares.server";
import { shareScopeHeading } from "@/lib/share-scope";

interface ProjectSharePageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** /s/{token} — a project share link, opened by somebody without an account
 *  (ADR 0051), titled by its scope (ADR 0053). A live window: every load re-resolves the project's current
 *  files. A download link shows them, the first 200 server-rendered; an
 *  upload-only link learns the project's name and the owner's byline and
 *  nothing else, beside the send form. Every refusal is the same not-found
 *  page. */
export default async function ProjectSharePage({ params }: ProjectSharePageProps) {
  await connection();
  const { token } = await params;
  const share = await openProjectShare(token);
  if (!share) notFound();

  const firstPage = share.canDownload ? await listProjectShareAssets(token, null) : null;
  if (share.canDownload && !firstPage) notFound();

  // Titled by what the link carries (ADR 0053): the project, the Workspace
  // being shared, or a fixed set of files from the project.
  const what = share.scope === "board" ? "Shared workspace" : share.scope === "selection" ? "Shared files" : "Shared project";
  const kicker = share.canDownload && share.canUpload
    ? `${what} · download and send files`
    : share.canDownload
      ? `${what} · download files`
      : "File request";
  const heading = shareScopeHeading({
    scope: share.scope,
    projectName: share.projectName,
    boardName: share.boardName,
    fileCount: share.fileCount,
  });
  const noun = share.scope === "board" ? "Workspace" : "project";
  const dek = !share.canDownload
    ? `Send files into this ${noun}. The link works until ${formatShareDate(share.expiresAt)}.`
    : share.scope === "selection"
      ? `A set of files picked by the owner. The link works until ${formatShareDate(share.expiresAt)}.`
      : `This link shows the ${noun} as it is now. It works until ${formatShareDate(share.expiresAt)}.`;

  return (
    <div className="public-share-scroll-root">
      <header className="public-share-app-header">
        <div className="public-share-header-inner">
          <div className="public-share-brand">
            <strong>ArchiveMind</strong>
            <span aria-hidden="true">/</span>
            <span>{share.canDownload ? what : "File request"}</span>
          </div>
        </div>
      </header>

      <main className="public-share-main">
        <header className="public-share-article-lead" style={{ maxWidth: 820 }}>
          <div className="public-share-kicker">{kicker}</div>
          <h1>{heading}</h1>
          {share.scope === "board" && share.boardName ? (
            <div className="public-share-kicker" style={{ marginTop: 6 }}>From {share.projectName}</div>
          ) : null}
          <p className="public-share-dek" style={{ fontSize: 17 }}>{dek}</p>
        </header>

        {share.canDownload && firstPage ? (
          <ProjectShareFiles token={token} initialPage={firstPage} fileCount={share.fileCount ?? firstPage.files.length} />
        ) : null}

        {share.canUpload ? <ProjectShareSendForm token={token} /> : null}

        <RightsFooter rights={share.rights} expiresAt={share.expiresAt} />
      </main>
    </div>
  );
}
