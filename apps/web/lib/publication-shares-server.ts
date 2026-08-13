import { z } from "zod";
import { streamObject, type R2ObjectStream } from "./r2";
import {
  publicPublicationShareSchema,
  publicationRightsSchema,
  publicationShareTokenHash,
  publicationShareTokenSchema,
  publicationSnapshotSchema,
  type PublicPublicationShare,
} from "./publication-shares";
import {
  resolvePublicationShareAssetRpc,
  resolvePublicationSharePreviewRpc,
  resolvePublicationShareRpc,
} from "./integrations/publication-shares.server";

const resolvedAssetSchema = z.object({
  publicId: z.string().uuid(),
  position: z.number().int().nonnegative(),
  filename: z.string().trim().min(1).max(500),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  downloadFilename: z.string().trim().min(1).max(500),
  downloadMimeType: z.string().trim().min(1).max(200),
  downloadQuality: z.enum(["original", "web_1024"]),
});

const resolvedShareRowSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["article", "instagram_carousel"]),
  name: z.string().trim().min(1).max(160),
  snapshot: publicationSnapshotSchema,
  rights: publicationRightsSchema,
  allow_downloads: z.boolean(),
  created_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).nullable(),
  assets: z.array(resolvedAssetSchema).max(20),
});

const resolvedDownloadRowSchema = z.object({
  share_id: z.string().uuid(),
  public_id: z.string().uuid(),
  download_r2_key: z.string().trim().min(1).max(2_000),
  download_filename: z.string().trim().min(1).max(500),
  download_mime_type: z.string().trim().min(1).max(200),
  download_quality: z.enum(["original", "web_1024"]),
});

const resolvedPreviewRowSchema = z.object({
  share_id: z.string().uuid(),
  public_id: z.string().uuid(),
  preview_r2_key: z.string().trim().min(1).max(2_000),
});

async function tokenHash(rawToken: string): Promise<string | null> {
  if (!publicationShareTokenSchema.safeParse(rawToken).success) return null;
  return publicationShareTokenHash(rawToken);
}

/** Narrow anonymous RPC → safe public projection. No R2 key and no signature
 * crosses this boundary at all: pictures and files are both addressed as
 * `/p/{token}/media/{publicId}` paths that re-check the token when the browser
 * actually asks for the bytes. */
export async function resolvePublicShare(rawToken: string): Promise<PublicPublicationShare | null> {
  const hash = await tokenHash(rawToken);
  if (!hash) return null;

  const { data, error } = await resolvePublicationShareRpc(hash);
  if (error || !data) return null;

  const row = resolvedShareRowSchema.safeParse(data);
  if (!row.success) return null;
  if (row.data.kind !== row.data.snapshot.kind || row.data.name !== row.data.snapshot.name) return null;

  const sortedAssets = [...row.data.assets].sort((left, right) => left.position - right.position);
  const publicIds = sortedAssets.map((asset) => asset.publicId);
  if (
    publicIds.length !== row.data.snapshot.publicAssetIds.length ||
    publicIds.some((publicId, index) => publicId !== row.data.snapshot.publicAssetIds[index])
  ) return null;

  const assets = sortedAssets.map((asset) => ({
    publicId: asset.publicId,
    filename: asset.filename,
    width: asset.width,
    height: asset.height,
    downloadQuality: asset.downloadQuality,
  }));

  const share = publicPublicationShareSchema.safeParse({
    kind: row.data.kind,
    name: row.data.name,
    snapshot: row.data.snapshot,
    rights: row.data.rights,
    assets,
    allowDownloads: row.data.allow_downloads,
    createdAt: row.data.created_at,
    expiresAt: row.data.expires_at,
  });
  return share.success ? share.data : null;
}

/** Resolve one rendered picture. Deliberately independent of the download
 * capability: a publication with downloads switched off still has to show its
 * own photographs. Revocation and expiry stop the very next image request. */
export async function resolvePublicSharePreview(
  rawToken: string,
  publicAssetId: string,
): Promise<R2ObjectStream | null> {
  const hash = await tokenHash(rawToken);
  if (!hash || !z.string().uuid().safeParse(publicAssetId).success) return null;

  const { data, error } = await resolvePublicationSharePreviewRpc(hash, publicAssetId);
  if (error || !data) return null;
  const row = resolvedPreviewRowSchema.safeParse(data);
  if (!row.success || row.data.public_id !== publicAssetId) return null;

  return streamObject(row.data.preview_r2_key);
}

/** Resolve one authorized attachment without first returning the share body.
 * Invalid, expired, revoked, download-disabled and foreign media all collapse
 * to null so the public route is not an existence oracle. */
export async function resolvePublicShareAsset(
  rawToken: string,
  publicAssetId: string,
): Promise<{
  object: R2ObjectStream;
  filename: string;
  mimeType: string;
  quality: "original" | "web_1024";
} | null> {
  const hash = await tokenHash(rawToken);
  if (!hash || !z.string().uuid().safeParse(publicAssetId).success) return null;

  const { data, error } = await resolvePublicationShareAssetRpc(hash, publicAssetId);
  if (error || !data) return null;
  const row = resolvedDownloadRowSchema.safeParse(data);
  if (!row.success || row.data.public_id !== publicAssetId) return null;

  return {
    object: await streamObject(row.data.download_r2_key),
    filename: row.data.download_filename,
    mimeType: row.data.download_mime_type,
    quality: row.data.download_quality,
  };
}
