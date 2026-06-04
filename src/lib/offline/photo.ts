// Photo capture helpers: read GPS (best-effort), then produce a downscaled,
// EXIF-oriented JPEG with a small timestamp/GPS overlay for evidence quality.

const MAX_EDGE = 2000

export interface Gps {
  lat: number
  lng: number
  accuracy: number
}

/** Best-effort current position; resolves null if denied/unavailable/timed out. */
export function getGps(): Promise<Gps | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null)
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    )
  })
}

/**
 * Draw the image to a canvas — EXIF-oriented and downscaled to MAX_EDGE — then
 * overlay a readable timestamp (and GPS, if available) in the bottom-left, and
 * return a JPEG blob. Aspect ratio is preserved; the image is never cropped.
 */
export async function stampPhoto(
  file: File,
  meta: { capturedAt: string; gpsLat: number | null; gpsLng: number | null }
): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(file)
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
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

  const lines: string[] = [new Date(meta.capturedAt).toLocaleString()]
  if (meta.gpsLat != null && meta.gpsLng != null) {
    lines.push(`${meta.gpsLat.toFixed(5)}, ${meta.gpsLng.toFixed(5)}`)
  }

  const fontSize = Math.max(13, Math.round(width * 0.022))
  const pad = Math.round(fontSize * 0.45)
  const lineH = Math.round(fontSize * 1.3)
  ctx.font = `${fontSize}px sans-serif`
  ctx.textBaseline = 'top'
  const boxW = Math.ceil(Math.max(...lines.map(l => ctx.measureText(l).width)) + pad * 2)
  const boxH = lineH * lines.length + pad

  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, height - boxH, boxW, boxH)
  ctx.fillStyle = '#ffffff'
  lines.forEach((l, i) => ctx.fillText(l, pad, height - boxH + pad / 2 + i * lineH))

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      b => (b ? resolve(b) : reject(new Error('Failed to render photo'))),
      'image/jpeg',
      0.85
    )
  })
}

/** Filesystem-safe filename for the storage path. */
export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}
