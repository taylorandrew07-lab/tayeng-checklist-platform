// Generates every logo and icon the app serves from the approved 2026 masters.
//
//   node brand-assets/generate.mjs
//
// Sources: brand-assets/company/ (the exported logo pack — read its README). Runs from the repo root.
// Outputs: public/brand/* and public/favicon.ico. Re-run after replacing a master;
// nothing else in the repo edits these files by hand.
//
// Rules carried over from the pack:
//   * The "T" in the mark is NEGATIVE SPACE. Every output keeps the master's alpha
//     (lockups) or its own background (icons) — nothing here flattens onto white.
//   * The lockups are 4.3:1. They are exported at screen widths only; consumers
//     size them by WIDTH (or height with width auto) — never stretch.
//   * Android adaptive icons come from the maskable master (mark at 60%), the rest
//     from the plain navy master, exactly as the pack prescribes.
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SRC = 'brand-assets/company'
const OUT = 'public/brand'
const src = (f) => path.join(SRC, f)
const out = (f) => path.join(OUT, f)

const png = (img) => img.png({ compressionLevel: 9, adaptiveFiltering: true })

/** Pack PNG blobs into a .ico container (PNG-in-ICO; supported by every current browser). */
function ico(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)
  const dir = Buffer.alloc(16 * entries.length)
  let offset = 6 + dir.length
  entries.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)     // width
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1) // height
    dir.writeUInt8(0, o + 2)                      // palette
    dir.writeUInt8(0, o + 3)                      // reserved
    dir.writeUInt16LE(1, o + 4)                   // planes
    dir.writeUInt16LE(32, o + 6)                  // bpp
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

await mkdir(OUT, { recursive: true })

// ── Lockups (screen) ────────────────────────────────────────────────────────
// White type for the navy sidebar / auth pages / preview bands; dark type for
// white surfaces and every printed letterhead (PDF, .docx, the HTML annex).
// 1440px covers the widest placement (448 CSS px on the login page) at 3× DPR.
await png(sharp(src('lockup-white-transparent.png')).resize({ width: 1440 })).toFile(out('lockup-white.png'))
await png(sharp(src('lockup-dark-transparent.png')).resize({ width: 1200 })).toFile(out('lockup-dark.png'))

// ── App icons (square, mark on navy) ────────────────────────────────────────
const navy = src('app-icon-1024-navy.png')
const maskable = src('app-icon-1024-navy-maskable.png')
const square = async (from, size, file) =>
  png(sharp(from).resize(size, size, { kernel: sharp.kernel.lanczos3 })).toFile(out(file))

await square(navy, 16, 'favicon-16.png')
await square(navy, 32, 'favicon-32.png')
await square(navy, 180, 'apple-touch-icon.png')
await square(navy, 192, 'icon-192.png')
await square(navy, 512, 'icon-512.png')
await square(maskable, 192, 'icon-maskable-192.png')
await square(maskable, 512, 'icon-maskable-512.png')

// favicon.ico — 16/32/48 in one file, at the site root where browsers look unprompted.
const icoEntries = []
for (const size of [16, 32, 48]) {
  icoEntries.push({ size, data: await png(sharp(navy).resize(size, size, { kernel: sharp.kernel.lanczos3 })).toBuffer() })
}
await writeFile('public/favicon.ico', ico(icoEntries))

console.log('brand assets written to public/brand and public/favicon.ico')
