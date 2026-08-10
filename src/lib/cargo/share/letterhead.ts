// The company letterhead as a data URI, for documents rendered on the server.
//
// Fetched over HTTP from the deployment's own origin, NOT read off disk: on
// Vercel `public/` is served by the CDN and is not reliably present in the
// serverless function bundle, so fs.readFile('public/…') fails there. This is
// the same approach lib/pdf/renderInvoice.ts takes, for the same reason.
//
// logo-invoice.png is the PRINT logo (dark wordmark) every document uses — see
// the note in lib/cargo/pdf/render.ts about logo-full.png being the white-text
// screen version. At 760x191 it is ~109 KB, which would be ~145 KB once base64
// encoded and then re-sent inside every share page, so it is downscaled once to
// letterhead width (~9 KB) and cached for the life of the lambda.

const cache = new Map<string, string | null>()

/** Data URI for the letterhead, or null if it can't be produced (the annex then
 *  falls back to the company name + tagline as text, like the invoice does). */
export async function getLetterheadDataUrl(origin: string): Promise<string | null> {
  const hit = cache.get(origin)
  if (hit !== undefined) return hit

  let result: string | null = null
  try {
    const res = await fetch(new URL('/logo-invoice.png', origin))
    if (res.ok) {
      const original = Buffer.from(await res.arrayBuffer())
      // sharp is already a dependency and is listed in serverExternalPackages.
      const sharp = (await import('sharp')).default
      const small = await sharp(original).resize({ width: 340 }).png({ compressionLevel: 9, palette: true }).toBuffer()
      result = `data:image/png;base64,${small.toString('base64')}`
    }
  } catch {
    result = null
  }

  cache.set(origin, result)
  return result
}
