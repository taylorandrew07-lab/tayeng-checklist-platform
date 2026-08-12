// Shrink a camera photo before it is uploaded, or queued in IndexedDB for a later
// upload. One helper, two problems:
//
//  - Offline queueing holds the bytes on the device. A survey can produce 40+ photos and
//    a modern phone shoots 3-6MB each, which is enough for the browser to start evicting
//    our IndexedDB under storage pressure. Losing a queued photo means losing evidence.
//  - The report route re-encodes every EXIF-rotated photo through `sharp` inside a 60s
//    serverless budget and then base64-inlines it (which inflates it by a further third).
//    Raw phone photos put a photo-heavy report uncomfortably close to that ceiling.
//
// It also removes the rotation problem at source. `createImageBitmap(..., {
// imageOrientation: 'from-image' })` BAKES the EXIF orientation into the pixels, and the
// canvas then writes a file with no EXIF at all — so the PDF route sees orientation 1,
// skips its rotate/re-encode pass entirely, and the photo is still the right way up.
//
// Never throws and never returns nothing: if any step is unsupported or fails, the
// original file is handed back untouched. A worse-compressed photo is a nuisance; a
// dropped one is a lost finding.

export interface PreparedImage {
  blob: Blob
  filename: string
}

/** Longest edge, in pixels, of a prepared photo. Comfortably above what the report grid
 *  (2 across on an A4 page) or an on-screen lightbox can resolve. */
const MAX_EDGE = 1920
const JPEG_QUALITY = 0.82

function jpegName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '') + '.jpg'
}

export async function downscaleImage(file: File, maxEdge: number = MAX_EDGE): Promise<PreparedImage> {
  const original: PreparedImage = { blob: file, filename: file.name }

  // GIF/SVG and anything non-raster: leave alone rather than flatten it badly.
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return original
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return original

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return original
  }

  try {
    const { width, height } = bitmap
    if (!width || !height) return original

    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob || blob.size === 0) return original

    // An already-small, already-optimised photo can come out BIGGER after a JPEG
    // round-trip. Keep whichever is smaller, as long as we didn't need to resize.
    if (scale === 1 && blob.size >= file.size) return original

    return { blob, filename: jpegName(file.name) }
  } catch {
    return original
  } finally {
    bitmap.close?.()
  }
}

/** Prepare a batch, in order. One failure never affects the others. */
export async function downscaleImages(files: File[], maxEdge: number = MAX_EDGE): Promise<PreparedImage[]> {
  return Promise.all(files.map(f => downscaleImage(f, maxEdge)))
}
