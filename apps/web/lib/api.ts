import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupMeta, Photo, Project, SourceMeta } from "@/types";
import { GROUP_LIST, PROJECTS, SOURCE_LIST } from "./mock-data";
import { getRealPhotos } from "./assets";
import { createClient } from "./supabase/server";

/**
 * The single data-access layer. Every component/hook reads domain records
 * through these functions — never from `lib/mock-data.ts` directly.
 *
 * getPhotos() is REAL as of Phase 1 (issue #6): the caller's own assets with
 * presigned preview URLs, mapped into the mockup's Photo shape (server-only —
 * it presigns R2 URLs). The remaining functions swap in with their phases
 * (projects #17, canvas aggregates #18).
 */

/** Pass the page's own RLS-scoped `supabase` when it has already auth-guarded
 *  the request — that skips a second client + a second network `getUser()`
 *  round trip (one full hop off the canvas load). */
export async function getPhotos(projectId?: string, supabase?: SupabaseClient): Promise<Photo[]> {
  if (supabase) return getRealPhotos(supabase, projectId);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return [];
  return getRealPhotos(client, projectId);
}

export async function getPhoto(id: string): Promise<Photo | null> {
  const photos = await getPhotos();
  return photos.find((p) => p.id === id) ?? null;
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
