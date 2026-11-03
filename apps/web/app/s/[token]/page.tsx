import { connection } from "next/server";
import { notFound } from "next/navigation";
import ProjectShareFiles from "@/components/share/ProjectShareFiles";
import RightsFooter, { formatShareDate } from "@/components/share/RightsFooter";
import { listProjectShareAssets, openProjectShare } from "@/lib/integrations/project-shares.server";

interface ProjectSharePageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** /s/{token} — a project share link, opened by somebody without an account
 *  (ADR 0051). A live window: every load re-resolves the project's current
 *  files. A download link shows them, the first 200 server-rendered; an
 *  upload-only link learns the project's name and the owner's byline and
 *  nothing else. Every refusal is the same not-found page. */
export default async function ProjectSharePage({ params }: ProjectSharePageProps) {
  await connection();
  const { token } = await params;
  const share = await openProjectShare(token);
  if (!share) notFound();

  const firstPage = share.canDownload ? await listProjectShareAssets(token, null) : null;
  if (share.canDownload && !firstPage) notFound();

  const kicker = share.canDownload && share.canUpload
    ? "Shared project · download and send files"
    : share.canDownload
      ? "Shared project · download files"
      : "File request";

  return (
    <div className="public-share-scroll-root">
      <header className="public-share-app-header">
        <div className="public-share-header-inner">
          <div className="public-share-brand">
            <strong>ArchiveMind</strong>
            <span aria-hidden="true">/</span>
            <span>{share.canDownload ? "Shared project" : "File request"}</span>
          </div>
        </div>
      </header>

      <main className="public-share-main">
        <header className="public-share-article-lead" style={{ maxWidth: 820 }}>
          <div className="public-share-kicker">{kicker}</div>
          <h1>{share.projectName}</h1>
          <p className="public-share-dek" style={{ fontSize: 17 }}>
            {share.canDownload
              ? `This link shows the project as it is now. It works until ${formatShareDate(share.expiresAt)}.`
              : `Send files into this project. The link works until ${formatShareDate(share.expiresAt)}.`}
          </p>
        </header>

        {share.canDownload && firstPage ? (
          <ProjectShareFiles token={token} initialPage={firstPage} fileCount={share.fileCount ?? firstPage.files.length} />
        ) : null}

        {share.canUpload ? (
          // The send form lands here with anonymous uploads (ADR 0051 §9).
          <section
            id="send-files"
            className="public-share-files"
            aria-labelledby="send-files-title"
            data-share-upload-slot=""
            style={{ marginTop: 56 }}
          >
            <div className="public-share-files-lead">
              <div>
                <div className="public-share-kicker">Send files</div>
                <h2 id="send-files-title">Add your files</h2>
              </div>
              <p>Sending files through this link is not available yet. Ask the person who shared it how to send them for now.</p>
            </div>
          </section>
        ) : null}

        <RightsFooter rights={share.rights} expiresAt={share.expiresAt} />
      </main>
    </div>
  );
}
