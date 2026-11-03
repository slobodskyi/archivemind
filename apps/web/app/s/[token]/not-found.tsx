import ShareUnavailable from "@/components/share/ShareUnavailable";

export default function ProjectShareNotFound() {
  return (
    <ShareUnavailable
      kicker="ArchiveMind · shared project"
      title="Link unavailable"
      body="This link may have expired or been turned off. Ask the person who shared it for a new link."
    />
  );
}
