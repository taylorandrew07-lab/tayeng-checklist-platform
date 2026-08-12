import { describe, it, expect, vi, afterEach } from 'vitest'
import { downscaleImage, downscaleImages } from './downscaleImage'

// The contract that matters in the field: this helper NEVER loses a photo. Every
// unsupported format, missing browser API or mid-way failure must hand the original
// file straight back, because a queued photo is the only copy of a finding.

function file(name: string, type: string, size = 4_000_000): File {
  const f = new File([new Uint8Array(8)], name, { type })
  // File size is read-only; the helper only compares it, so stub it.
  Object.defineProperty(f, 'size', { value: size })
  return f
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('downscaleImage — never loses the photo', () => {
  it('returns the original for a non-raster type', async () => {
    const f = file('diagram.svg', 'image/svg+xml')
    const out = await downscaleImage(f)
    expect(out.blob).toBe(f)
    expect(out.filename).toBe('diagram.svg')
  })

  it('returns the original when createImageBitmap is unavailable', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const f = file('photo.jpg', 'image/jpeg')
    const out = await downscaleImage(f)
    expect(out.blob).toBe(f)
  })

  it('returns the original when decoding throws (corrupt or unsupported HEIC)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')))
    const f = file('IMG_0001.HEIC', 'image/heic')
    const out = await downscaleImage(f)
    expect(out.blob).toBe(f)
    expect(out.filename).toBe('IMG_0001.HEIC')
  })

  it('returns the original when the canvas produces nothing', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }))
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (cb: (b: Blob | null) => void) => cb(null),
      }),
    })
    const f = file('photo.jpg', 'image/jpeg')
    const out = await downscaleImage(f)
    expect(out.blob).toBe(f)
  })
})

describe('downscaleImage — resizing', () => {
  const bitmapOf = (width: number, height: number) => ({ width, height, close: vi.fn() })

  function stubCanvas(outSize: number) {
    const drawn: { w: number; h: number }[] = []
    const canvas: any = {
      width: 0, height: 0,
      getContext: () => ({
        drawImage: (_b: unknown, _x: number, _y: number, w: number, h: number) => drawn.push({ w, h }),
      }),
      toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array(outSize)], { type: 'image/jpeg' })),
    }
    vi.stubGlobal('document', { createElement: () => canvas })
    return { drawn, canvas }
  }

  it('caps the long edge and keeps the aspect ratio', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmapOf(4032, 3024)))
    const { drawn } = stubCanvas(400_000)
    const out = await downscaleImage(file('photo.jpg', 'image/jpeg'))
    expect(drawn[0]).toEqual({ w: 1920, h: 1440 })
    expect(out.filename).toBe('photo.jpg')
    expect(out.blob.size).toBe(400_000)
  })

  it('honours a caller-supplied max edge, portrait included', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmapOf(3024, 4032)))
    const { drawn } = stubCanvas(1000)
    await downscaleImage(file('photo.jpg', 'image/jpeg'), 800)
    expect(drawn[0]).toEqual({ w: 600, h: 800 })
  })

  it('renames a re-encoded PNG to .jpg', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmapOf(4000, 3000)))
    stubCanvas(50_000)
    const out = await downscaleImage(file('screenshot.PNG', 'image/png'))
    expect(out.filename).toBe('screenshot.jpg')
  })

  it('keeps the original when it is already small and the re-encode is no better', async () => {
    // 800x600 needs no resize, and the JPEG round-trip came out larger — keep the source.
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmapOf(800, 600)))
    stubCanvas(90_000)
    const f = file('small.jpg', 'image/jpeg', 80_000)
    const out = await downscaleImage(f)
    expect(out.blob).toBe(f)
  })

  it('closes the decoded bitmap so it is not left holding memory', async () => {
    const bmp = bitmapOf(4000, 3000)
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bmp))
    stubCanvas(10_000)
    await downscaleImage(file('photo.jpg', 'image/jpeg'))
    expect(bmp.close).toHaveBeenCalled()
  })

  it('bakes in the EXIF orientation rather than preserving it', async () => {
    // The PDF route only re-encodes photos whose EXIF orientation is not 1. Decoding
    // with 'from-image' and re-drawing produces an upright image with no EXIF, so that
    // pass is skipped — which is the whole point at 40 photos inside a 60s budget.
    const spy = vi.fn().mockResolvedValue(bitmapOf(4000, 3000))
    vi.stubGlobal('createImageBitmap', spy)
    stubCanvas(10_000)
    await downscaleImage(file('photo.jpg', 'image/jpeg'))
    expect(spy).toHaveBeenCalledWith(expect.anything(), { imageOrientation: 'from-image' })
  })
})

describe('downscaleImages', () => {
  it('preserves order and lets one failure through untouched', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn()
      .mockResolvedValueOnce({ width: 4000, height: 3000, close: vi.fn() })
      .mockRejectedValueOnce(new Error('bad'))
      .mockResolvedValueOnce({ width: 4000, height: 3000, close: vi.fn() }))
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array(1000)], { type: 'image/jpeg' })),
      }),
    })
    const files = [file('a.jpg', 'image/jpeg'), file('b.jpg', 'image/jpeg'), file('c.jpg', 'image/jpeg')]
    const out = await downscaleImages(files)
    expect(out).toHaveLength(3)
    expect(out[0].blob.size).toBe(1000)
    expect(out[1].blob).toBe(files[1]) // the failure kept its original bytes
    expect(out[2].blob.size).toBe(1000)
  })
})
