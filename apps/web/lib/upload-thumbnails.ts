/** Local previews for optimistic upload tiles.
 *
 *  A dropped photo shows on the canvas before the worker has made its preview.
 *  That early image used to be the ORIGINAL file as the tile's CSS background,
 *  fifty per batch. iPad Safari keeps every such original's bytes in the page's
 *  memory and decodes each one to several megapixels even inside a 256 px tile,
 *  so a big upload cost the tab around a gigabyte and iOS killed it mid-upload
 *  ("A problem repeatedly occurred").
 *
 *  So a tile now gets a thumbnail the size of the worker's own, drawn from the
 *  original ONE FILE AT A TIME: at most one full-size decode is alive at once,
 *  and what stays behind is a few tens of KB. The same decode answers the
 *  photo's real aspect, which the tile needs before the server preview lands. */

/** Long edge of a local preview: the worker's `thumb` size
 *  (apps/worker/src/services/previews.ts). The server preview that replaces it
 *  is no sharper, so the swap is invisible. */
export const UPLOAD_THUMB_EDGE = 256;

export interface UploadThumb {
  /** Object URL of the small image. Whoever receives it owns it and revokes it. */
  url: string;
  /** The ORIGINAL's oriented size: the tile's aspect, not the thumbnail's. */
  width: number;
  height: number;
}

/** Fit width × height inside a square of `edge`, never upscaling. */
export function thumbnailSize(
  width: number,
  height: number,
  edge = UPLOAD_THUMB_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** PNG for anything that can carry transparency, so a logo does not land on
 *  black. A photo is a JPEG and stays one. */
function thumbnailType(file: File): "image/png" | "image/jpeg" {
  return /png|gif|webp|avif/i.test(file.type) || /\.(?:png|gif|webp|avif)$/i.test(file.name)
    ? "image/png"
    : "image/jpeg";
}

/** Encode the canvas now. Not `toBlob`: Chromium runs its encode in an idle
 *  period, and a tab that is busy or not painting has none, so every call
 *  then waits about a second (measured) and a queue of 500 takes minutes. The
 *  encode itself is milliseconds at this size. The data URL never reaches the
 *  DOM: a tile gets a blob URL, which session replay records as an opaque
 *  string rather than as the photo's pixels. */
function encodeCanvas(canvas: HTMLCanvasElement, type: string): Blob | null {
  const dataUrl = canvas.toDataURL(type, 0.82);
  const header = /^data:(image\/[a-z]+);base64,/.exec(dataUrl);
  if (!header) return null;
  const binary = atob(dataUrl.slice(header[0].length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: header[1] });
}

/** Draw `file` into a small image. Resolves null when the browser cannot
 *  decode it, and the tile keeps its filename placeholder.
 *
 *  It loads an <img> and draws it, rather than calling `img.decode()`, which
 *  may decode the whole original at full size: drawing into a small canvas
 *  lets WebKit decode a subsampled copy. drawImage of an <img> also honours
 *  the EXIF orientation, as the old CSS-background preview did. */
export async function renderUploadThumb(
  file: File,
  edge = UPLOAD_THUMB_EDGE,
): Promise<UploadThumb | null> {
  const source = URL.createObjectURL(file);
  const image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image did not decode"));
      image.src = source;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!(width > 0 && height > 0)) return null;
    const size = thumbnailSize(width, height, edge);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = encodeCanvas(canvas, thumbnailType(file));
    // iOS caps the memory of all live canvases together: hand this one back
    // now, not whenever the collector gets to it.
    canvas.width = 0;
    canvas.height = 0;
    return blob ? { url: URL.createObjectURL(blob), width, height } : null;
  } catch {
    return null;
  } finally {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
    URL.revokeObjectURL(source);
  }
}

export interface ThumbJob {
  id: string;
  file: File;
}

export interface ThumbQueueOptions {
  render: (file: File) => Promise<UploadThumb | null>;
  /** Asked before a job renders and again once it has: a tile can leave while
   *  its turn waits or its file decodes (its server preview landed, its upload
   *  failed, the batch was retried). */
  isWanted: (id: string) => boolean;
  /** A finished thumbnail for a tile that still wants it. Owns `thumb.url`. */
  onThumb: (id: string, thumb: UploadThumb) => void;
  /** Releases a thumbnail nobody wants any more. Injectable for tests. */
  revoke?: (url: string) => void;
}

export interface ThumbQueue {
  enqueue: (jobs: readonly ThumbJob[]) => void;
  /** Jobs still waiting for their turn; the preview cap counts them. */
  pending: () => number;
  /** Drop every waiting job. A render already running still finishes, and its
   *  thumbnail is revoked rather than delivered. Later enqueues work again. */
  clear: () => void;
}

/** Renders strictly one job at a time, in order. That is the whole point: a
 *  batch of 500 photos never has more than one original decoded at once. */
export function createThumbQueue(options: ThumbQueueOptions): ThumbQueue {
  const revoke = options.revoke ?? ((url: string) => URL.revokeObjectURL(url));
  let waiting: ThumbJob[] = [];
  let running = false;
  let generation = 0;

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = waiting.shift(); job; job = waiting.shift()) {
        if (!options.isWanted(job.id)) continue;
        const startedIn = generation;
        let thumb: UploadThumb | null = null;
        try {
          thumb = await options.render(job.file);
        } catch {
          thumb = null;
        }
        if (!thumb) continue;
        if (startedIn !== generation || !options.isWanted(job.id)) revoke(thumb.url);
        else options.onThumb(job.id, thumb);
      }
    } finally {
      running = false;
    }
  };

  return {
    enqueue(jobs) {
      if (jobs.length === 0) return;
      waiting.push(...jobs);
      void pump();
    },
    pending: () => waiting.length,
    clear() {
      generation += 1;
      waiting = [];
    },
  };
}
