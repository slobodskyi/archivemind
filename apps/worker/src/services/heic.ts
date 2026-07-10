import decode from "heic-decode";

/** HEIC → raw RGBA for sharp (spec §8.1): sharp prebuilds exclude HEIC
 *  (patents); heic-decode (maintained wasm libheif) yields raw pixels we pipe
 *  into sharp's raw input — no slow pure-JS re-encode. ~1–3 s and up to
 *  ~200 MB RAM per iPhone shot: the ingest handler keeps decode concurrency
 *  at 1 by processing files sequentially. */
export async function heicToRaw(
  buf: Buffer,
): Promise<{ data: Buffer; width: number; height: number }> {
  const { width, height, data } = await decode({ buffer: buf });
  return { data: Buffer.from(data), width, height };
}
