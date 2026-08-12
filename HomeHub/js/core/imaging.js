/* Shrinking pictures before they go into storage.

   A photo off a phone is around 4000px on the long edge and three or
   four megabytes. The iPad it will be displayed on is 2732px at its
   widest, so most of that detail is stored for nobody — and a hundred of
   them is most of a gigabyte of IndexedDB, read back in full every time
   the slideshow or the settings grid wants to know what exists.

   So every photo is written twice: once at screen size, and once as a
   thumbnail small enough that the whole library's worth can sit in
   memory at once. */

/** Long edge, in pixels, for the copy ambient mode displays. */
export const FULL_EDGE = 2560;

/** Long edge for the grid thumbnails. */
export const THUMB_EDGE = 320;

/**
 * Scale an image file down so its long edge is at most `maxEdge`.
 *
 * Returns `{ blob, w, h }`. Images already smaller than the target are
 * still re-encoded — a 900px PNG screenshot can easily be larger than
 * the 2560px JPEG of a photograph, and the point of this is bytes.
 *
 * Anything that fails to decode comes back untouched rather than lost.
 * Safari's HEIC support is the reason: the file picker usually hands
 * over a converted JPEG, but "usually" is not something to delete a
 * family photo over.
 */
export async function downscale(file, maxEdge, quality = 0.85) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    /* Downscaling in one step aliases badly on a 12× reduction, and the
       thumbnails are small enough that the difference shows. */
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('toBlob returned nothing');

    /* Re-encoding a small graphic can genuinely make it bigger. Keep
       whichever is smaller, as long as we still know the dimensions. */
    if (blob.size >= file.size && scale === 1) return { blob: file, w, h };
    return { blob, w, h };
  } catch (err) {
    console.warn('[imaging] could not resize, storing the original', err);
    return { blob: file, w: 0, h: 0 };
  }
}

/** The pair of blobs a stored photo needs: one to show, one to list. */
export async function prepare(file) {
  const full = await downscale(file, FULL_EDGE, 0.85);
  /* The thumbnail is derived from the already-shrunk copy where possible
     — decoding the 4000px original a second time is the slowest part of
     adding a photo, and doing it once per file adds up over a batch. */
  const source = full.blob === file ? file : full.blob;
  const thumb = await downscale(source, THUMB_EDGE, 0.78);
  return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h };
}
