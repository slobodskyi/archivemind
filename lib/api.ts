import type { GroupMeta, Photo, Project, SourceMeta } from "@/types";
import { GROUP_LIST, PHOTOS, PROJECTS, SOURCE_LIST } from "./mock-data";

/**
 * The single data-access layer. Every component/hook reads domain records
 * through these functions — never from `lib/mock-data.ts` directly. They are
 * async (resolving synchronously today) so a real fetch-based implementation
 * is a drop-in swap later, and so Server Components can `await` them.
 */

export async function getPhotos(): Promise<Photo[]> {
  return PHOTOS;
}

export async function getPhoto(id: string): Promise<Photo | null> {
  return PHOTOS.find((p) => p.id === id) ?? null;
}

export async function getProjects(): Promise<Project[]> {
  return PROJECTS;
}

export async function getGroups(): Promise<GroupMeta[]> {
  return GROUP_LIST;
}

export async function getSources(): Promise<SourceMeta[]> {
  return SOURCE_LIST;
}
