import ShareUnavailable from "@/components/share/ShareUnavailable";

export default function PublicShareNotFound() {
  return (
    <ShareUnavailable
      kicker="ArchiveMind · shared preview"
      title="Preview unavailable"
      body="This link may have expired or been turned off. Ask the person who shared it for a new preview link."
    />
  );
}
