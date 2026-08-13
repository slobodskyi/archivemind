import { connection } from "next/server";
import { notFound } from "next/navigation";
import PublicContentShare from "@/components/content/PublicContentShare";
import { resolvePublicShare } from "@/lib/publication-shares-server";

interface PublicSharePageProps {
  params: Promise<{ token: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicSharePage({ params }: PublicSharePageProps) {
  await connection();
  const { token } = await params;
  const share = await resolvePublicShare(token);
  if (!share) notFound();
  return <PublicContentShare share={share} rawToken={token} />;
}
