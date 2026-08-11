import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupMeta, Photo, Project, SourceMeta } from "@/types";
import { GROUP_LIST, PROJECTS, SOURCE_LIST } from "./mock-data";
import { getRealPhotoWindow, type PhotoWindow } from "./assets";
import { createClient } from "./supabase/server";

/**
 * getPhotos() is the LIVE Server-Component reader for assets (real since
 * Phase 1, #6): the caller's own rows with presigned preview URLs, mapped into
 * the mockup's Photo shape (server-only — it presigns R2 URLs).
 *
 * Everything else here — getPhoto/getProjects/getGroups/getSources — is a
 * retained DEAD MOCK with zero callers (tracked in #34), kept until its
 * feature's phase replaces or deletes it. This file is NOT the single data
 * seam anymore (ADR 0002 no longer holds): other reads live in
 * lib/projects.ts / lib/bootstrap.ts, and every write goes through the
 * app/api/* route handlers — see ARCHITECTURE.md "Seams".
 */

/** Pass the page's own RLS-scoped `supabase` when it has already auth-guarded
 *  the request — that skips a second client + a second network `getUser()`
 *  round trip (one full hop off the canvas load). */
export async function getPhotoWindow(projectId?: string, supabase?: SupabaseClient): Promise<PhotoWindow> {
  if (supabase) return getRealPhotoWindow(supabase, projectId);
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return { photos: [], total: 0 };
  return getRealPhotoWindow(client, projectId);
}

/** Backward-compatible photo-only reader. The canvas page uses the richer
 *  window above so a bounded response can never look like missing uploads. */
export async function getPhotos(projectId?: string, supabase?: SupabaseClient): Promise<Photo[]> {
  return (await getPhotoWindow(projectId, supabase)).photos;
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
