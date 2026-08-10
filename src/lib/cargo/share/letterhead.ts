// The company letterhead as a data URI, for documents rendered on the server.
//
// logo-invoice.png is the PRINT logo (dark wordmark) every document uses — see
// the note in lib/cargo/pdf/render.ts about logo-full.png being the white-text
// screen version. At 760x191 it is ~109 KB, which would be ~145 KB once base64
// encoded and would then be re-sent inside every share page. It is downscaled
// once to letterhead width (~9 KB) and cached for the life of the lambda.

import { promises as fs } from 'fs'
import path from 'path'

let cached: string | null | undefined

/** Data URI for the letterhead, or null if it can't be produced (the annex then
 *  falls back to the company name + tagline as text, like the invoice does). */
export async function getLetterheadDataUrl(): Promise<string | null> {
  if (cached !== undefined) return cached
  try {
    const file = path.join(process.cwd(), 'public', 'logo-invoice.png')
    const original = await fs.readFile(file)
    // sharp is already a dependency and is listed in serverExternalPackages.
    const sharp = (await import('sharp')).default
    const small = await sharp(original).resize({ width: 340 }).png({ compressionLevel: 9, palette: true }).toBuffer()
    cached = `data:image/png;base64,${small.toString('base64')}`
  } catch {
    cached = null
  }
  return cached
}
