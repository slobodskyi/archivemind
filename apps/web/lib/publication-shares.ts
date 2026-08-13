import { z } from "zod";
import {
  editRecipeSchema,
  inscribedCropForStraighten,
  resolveCropRect,
  workingDimensions,
} from "@archivemind/shared";
import {
  articleMediaPresentationSchema,
  contentDraftSchema,
  instagramCarouselSlidePresentationSchema,
  type ContentDraft,
} from "./content-drafts";
import { usedAssetIds } from "./content-package";

/** Public, immutable editorial snapshots created from browser-local drafts.
 *
 * The source draft is intentionally accepted only at the authenticated create
 * boundary. The stored/public shapes below omit its prompt, source set,
 * optimistic-save tokens, board id and real asset ids. */

const idSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.string().datetime({ offset: true });
const publicAssetIdSchema = z.string().uuid();

export const publicationShareOptionsSchema = z.object({
  expiresInDays: z.union([z.literal(7), z.literal(30), z.null()]).default(30),
  allowDownloads: z.boolean().default(true),
});

export type PublicationShareOptions = z.infer<typeof publicationShareOptionsSchema>;

export const createPublicationShareRequestSchema = z.object({
  draft: contentDraftSchema,
  options: publicationShareOptionsSchema,
});

export type CreatePublicationShareRequest = z.infer<typeof createPublicationShareRequestSchema>;

const publicArticleMediaSchema = z.object({
  publicAssetId: publicAssetIdSchema,
  presentation: articleMediaPresentationSchema,
  caption: z.string().max(2_000),
  altText: z.string().trim().max(1_000),
});

const publicArticleContentSchema = z.object({
  title: z.string().max(300),
  dek: z.string().max(1_000),
  intro: z.string().max(50_000),
  sections: z.array(
    z.object({
      id: idSchema,
      heading: z.string().max(300),
      body: z.string().max(50_000),
      media: z.array(publicArticleMediaSchema).max(20),
    }),
  ).max(100),
  socialExcerpt: z.string().max(2_200),
});

const publicCarouselContentSchema = z.object({
  caption: z.string().max(10_000),
  slides: z.array(
    z.object({
      id: idSchema,
      publicAssetId: publicAssetIdSchema.nullable(),
      headline: z.string().max(300),
      body: z.string().max(2_200),
      presentation: instagramCarouselSlidePresentationSchema,
    }),
  ).max(20),
  hashtags: z.array(z.string().min(1).max(100)).max(30),
  aspectRatio: z.enum(["4:5", "1:1"]),
});

export const publicationSnapshotSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("article"),
    name: z.string().trim().min(1).max(160),
    language: z.enum(["en", "uk", "ru"]),
    /** Ordered opaque ids of only the media actually placed in the output. */
    publicAssetIds: z.array(publicAssetIdSchema).max(20),
    content: publicArticleContentSchema,
  }),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("instagram_carousel"),
    name: z.string().trim().min(1).max(160),
    language: z.enum(["en", "uk", "ru"]),
    publicAssetIds: z.array(publicAssetIdSchema).max(20),
    content: publicCarouselContentSchema,
  }),
]);

export type PublicationSnapshot = z.infer<typeof publicationSnapshotSchema>;

export const publicationRightsSchema = z.object({
  creator: z.string().max(300).nullable(),
  credit: z.string().max(500).nullable(),
  copyrightNotice: z.string().max(500).nullable(),
  usageTerms: z.string().max(2_000).nullable(),
});

export type PublicationRights = z.infer<typeof publicationRightsSchema>;

/** No media URL lives here on purpose: both the picture and the file are addressed
 * as `/p/{token}/media/{publicId}` paths, revalidated per request. An R2
 * signature embedded in the page would keep working for its whole TTL after the
 * author turned the link off, and would expire under a lazily loaded image. */
export const publicationShareAssetSchema = z.object({
  publicId: publicAssetIdSchema,
  filename: z.string().trim().min(1).max(500),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  downloadQuality: z.enum(["original", "web_1024"]),
});

export type PublicationShareAsset = z.infer<typeof publicationShareAssetSchema>;

export const publicPublicationShareSchema = z.object({
  kind: z.enum(["article", "instagram_carousel"]),
  name: z.string().min(1).max(160),
  snapshot: publicationSnapshotSchema,
  rights: publicationRightsSchema,
  assets: z.array(publicationShareAssetSchema).max(20),
  allowDownloads: z.boolean(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export type PublicPublicationShare = z.infer<typeof publicPublicationShareSchema>;

export const createPublicationShareResponseSchema = z.object({
  shareId: z.string().uuid(),
  path: z.string().startsWith("/p/"),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export type CreatePublicationShareResponse = z.infer<typeof createPublicationShareResponseSchema>;

/** The author's own view of a live version. It carries status, never the token:
 * a lost URL is unrecoverable by design, but a link you cannot address must
 * still be one you can switch off. */
export const publicationShareSummarySchema = z.object({
  shareId: z.string().uuid(),
  sourceDraftId: idSchema,
  kind: z.enum(["article", "instagram_carousel"]),
  name: z.string().min(1).max(160),
  status: z.enum(["preparing", "ready", "revoked"]),
  allowDownloads: z.boolean(),
  createdAt: timestampSchema,
  expiresAt: timestampSchema.nullable(),
});

export type PublicationShareSummary = z.infer<typeof publicationShareSummarySchema>;

export const listPublicationSharesResponseSchema = z.object({
  shares: z.array(publicationShareSummarySchema).max(100),
});

/** A deadline that has passed is not a live link. The authoring UI reads this
 * before showing a link as usable: presenting an expired capability as live
 * sends the author's recipients to a 404 in the product's own voice.
 * `null` means no automatic expiry, and an unparseable value is treated as live
 * so a corrupt local record cannot hide a link that still works. */
export function publicationLinkExpired(expiresAt: string | null, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const deadline = new Date(expiresAt).getTime();
  return Number.isFinite(deadline) && deadline <= now;
}

export type PublicationShareDisplayStatus = "preparing" | "live" | "expired" | "revoked";

/** Database status plus its deadline form the author-facing truth. Expiry is a
 * derived state because the row deliberately stays `ready` for retention and
 * audit even after the public resolver has stopped serving it. */
export function publicationShareDisplayStatus(
  share: Pick<PublicationShareSummary, "status" | "expiresAt">,
  now: number = Date.now(),
): PublicationShareDisplayStatus {
  if (share.status === "revoked") return "revoked";
  if (publicationLinkExpired(share.expiresAt, now)) return "expired";
  return share.status === "ready" ? "live" : "preparing";
}

/** A preparing publication is included: it is not readable yet, but another
 * request may activate it, so deleting its browser-local source must revoke it
 * just like an already-live link. */
export function publicationShareRequiresRevoke(
  share: Pick<PublicationShareSummary, "status" | "expiresAt">,
  now: number = Date.now(),
): boolean {
  const status = publicationShareDisplayStatus(share, now);
  return status === "live" || status === "preparing";
}

/** Match the edited medium renderer's shape calculation. The worker starts
 * from the original medium, rotates/straightens/crops, then fits the result
 * inside the 1024px medium tier without enlargement. */
export function publicationPreviewDimensions(
  width: number | null,
  height: number | null,
  recipe: unknown,
): { width: number | null; height: number | null } {
  if (!width || !height) return { width, height };
  const parsed = editRecipeSchema.safeParse(recipe);
  if (!parsed.success) return { width, height };

  const crop = parsed.data.crop
    ?? (parsed.data.straighten
      ? inscribedCropForStraighten(width, height, parsed.data)
      : null);
  const working = workingDimensions(width, height, parsed.data);
  const rect = resolveCropRect(working.w, working.h, crop);
  const scale = Math.min(1, 1024 / Math.max(rect.width, rect.height));
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

const publicationShareLinkRecordSchema = z.object({
  schemaVersion: z.literal(1),
  draftId: idSchema,
  draftVersion: z.number().int().positive(),
  result: z.object({
    shareId: z.string().uuid(),
    url: z.string().url(),
    createdAt: timestampSchema,
    expiresAt: timestampSchema.nullable(),
  }),
});

export type PublicationShareLinkRecord = z.infer<typeof publicationShareLinkRecordSchema>;

const PUBLICATION_LINK_PREFIX = "archivemind:publication-link:v1:";

export function publicationShareLinkStorageKey(draftId: string): string {
  return `${PUBLICATION_LINK_PREFIX}${encodeURIComponent(idSchema.parse(draftId))}`;
}

/** Hash-only server tokens are intentionally unrecoverable. Since drafts are
 * browser-local in this phase, remember the last raw link beside that draft so
 * a reload in the same browser does not strand an unmanageable live link. */
export function savePublicationShareLink(record: PublicationShareLinkRecord): boolean {
  if (typeof window === "undefined") return false;
  const parsed = publicationShareLinkRecordSchema.safeParse(record);
  if (!parsed.success) return false;
  try {
    window.localStorage.setItem(
      publicationShareLinkStorageKey(parsed.data.draftId),
      JSON.stringify(parsed.data),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadPublicationShareLink(draftId: string): PublicationShareLinkRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(publicationShareLinkStorageKey(draftId));
    if (!raw) return null;
    const parsed = publicationShareLinkRecordSchema.safeParse(JSON.parse(raw) as unknown);
    return parsed.success && parsed.data.draftId === draftId ? parsed.data : null;
  } catch {
    return null;
  }
}

export function deletePublicationShareLink(draftId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(publicationShareLinkStorageKey(draftId));
    return true;
  } catch {
    return false;
  }
}

export const publicationShareTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export function publicationShareTokenHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(publicationShareTokenSchema.parse(token));
  return crypto.subtle.digest("SHA-256", bytes).then((hash) =>
    Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
}

/** Convert a private editor draft to the only shape an anonymous reader may
 * receive. Missing mappings are programming errors: publication must fail
 * closed instead of leaking a real asset id into the snapshot. */
export function createPublicationSnapshot(
  draft: ContentDraft,
  publicIdsByAssetId: ReadonlyMap<string, string>,
): PublicationSnapshot {
  for (const assetId of usedAssetIds(draft)) {
    if (!publicIdsByAssetId.has(assetId)) throw new Error("Missing public asset id");
  }

  if (draft.kind === "article") {
    return publicationSnapshotSchema.parse({
      schemaVersion: 1,
      kind: draft.kind,
      name: draft.name,
      language: draft.brief.language,
      publicAssetIds: usedAssetIds(draft).map((assetId) => publicIdsByAssetId.get(assetId)),
      content: {
        title: draft.content.title,
        dek: draft.content.dek,
        intro: draft.content.intro,
        sections: draft.content.sections.map((section) => ({
          id: section.id,
          heading: section.heading,
          body: section.body,
          media: section.media.map((media) => ({
            publicAssetId: publicIdsByAssetId.get(media.assetId),
            presentation: media.presentation,
            caption: media.caption,
            altText: media.altText,
          })),
        })),
        socialExcerpt: draft.content.socialExcerpt,
      },
    });
  }

  return publicationSnapshotSchema.parse({
    schemaVersion: 1,
    kind: draft.kind,
    name: draft.name,
    language: draft.brief.language,
    publicAssetIds: usedAssetIds(draft).map((assetId) => publicIdsByAssetId.get(assetId)),
    content: {
      caption: draft.content.caption,
      slides: draft.content.slides.map((slide) => ({
        id: slide.id,
        publicAssetId: slide.assetId ? publicIdsByAssetId.get(slide.assetId) : null,
        headline: slide.headline,
        body: slide.body,
        presentation: slide.presentation,
      })),
      hashtags: draft.content.hashtags,
      aspectRatio: draft.settings.aspectRatio,
    },
  });
}

/** Clipboard/download copy deliberately contains editorial text, not temporary
 * media URLs. Files are exposed as separately labelled downloads. */
export function serializePublicationText(snapshot: PublicationSnapshot): string {
  if (snapshot.kind === "article") {
    const lines = [`# ${snapshot.content.title || snapshot.name}`];
    if (snapshot.content.dek) lines.push("", snapshot.content.dek);
    if (snapshot.content.intro) lines.push("", snapshot.content.intro);
    for (const section of snapshot.content.sections) {
      if (section.heading) lines.push("", `## ${section.heading}`);
      if (section.body) lines.push("", section.body);
      for (const media of section.media) {
        if (media.caption) lines.push("", media.caption);
      }
    }
    if (snapshot.content.socialExcerpt) lines.push("", "## Social excerpt", "", snapshot.content.socialExcerpt);
    return `${lines.join("\n").trim()}\n`;
  }

  const lines = snapshot.content.slides.flatMap((slide, index) => [
    `SLIDE ${index + 1}`,
    slide.headline,
    slide.body,
    "",
  ]);
  lines.push("CAPTION", snapshot.content.caption, "", "HASHTAGS", snapshot.content.hashtags.join(" "));
  return `${lines.join("\n").trim()}\n`;
}
