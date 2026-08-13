import { createAdminClient } from "@/lib/supabase/admin";

/** Public-link token custody. These three calls deliberately live behind the
 * service-role fence: the Supabase anon key is browser-public, while the
 * resolver rows contain private R2 object keys that only this server may turn
 * into short-lived signatures. The SECURITY DEFINER functions remain the
 * narrow query surface; this module never issues a broad table select. */
export async function resolvePublicationShareRpc(tokenHash: string) {
  return createAdminClient()
    .rpc("resolve_publication_share", { p_token_hash: tokenHash })
    .maybeSingle();
}

export async function resolvePublicationSharePreviewRpc(tokenHash: string, publicAssetId: string) {
  return createAdminClient()
    .rpc("resolve_publication_share_preview", {
      p_token_hash: tokenHash,
      p_public_id: publicAssetId,
    })
    .maybeSingle();
}

export async function resolvePublicationShareAssetRpc(tokenHash: string, publicAssetId: string) {
  return createAdminClient()
    .rpc("resolve_publication_share_asset", {
      p_token_hash: tokenHash,
      p_public_id: publicAssetId,
    })
    .maybeSingle();
}
