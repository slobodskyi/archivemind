import ArchiveWorkspace from "@/components/workspace/ArchiveWorkspace";
import { getPhotos } from "@/lib/api";

export default async function Home() {
  const photos = await getPhotos();
  return <ArchiveWorkspace initialPhotos={photos} />;
}
