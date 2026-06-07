// Produce compressed JPEG data URLs for embedding photos in the PDF. The original
// full-resolution blob is kept in IndexedDB; only the PDF copy is downscaled, so
// reports stay email-friendly without ever degrading the stored evidence. Adapted
// from the canvas downscale in src/lib/offline/photo.ts. Aspect ratio is always
// preserved — photos are never cropped or distorted.

export type Quality = 'standard' | 'high'

const TIERS: Record<Quality, { maxEdge: number; jpegQuality: number }> = {
  standard: { maxEdge: 1600, jpegQuality: 0.7 },
  high: { maxEdge: 2400, jpegQuality: 0.85 },
}

export interface CompressedImage {
  dataUrl: string
  width: number
  height: number
}

/** Downscale a stored photo blob to a compressed JPEG data URL for the PDF. */
export async function compressForPdf(blob: Blob, quality: Quality): Promise<CompressedImage> {
  const { maxEdge, jpegQuality } = TIERS[quality]

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(blob)
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    throw new Error('Canvas not available')
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()

  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality)
  return { dataUrl, width, height }
}
