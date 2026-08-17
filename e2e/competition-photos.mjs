/**
 * Browse and fetch Photo Competition entries from a local machine.
 *
 * This exists so a Claude Code session can actually SEE what staff have uploaded, and
 * pull a chosen photo out for the marketing site (../Tayeng Website). Neither is possible
 * otherwise: both competition buckets are `public = false`, the app only ever reaches them
 * through 6-hour signed URLs, and mig 160 made every storage key an opaque `uuid.ext` at
 * the bucket root — no folder, no original filename, nothing browsable.
 *
 * READ-ONLY, ALWAYS. It never inserts, updates, deletes or uploads. Publishing a photo to
 * the website is a separate, deliberate act performed on instruction — nothing here syncs
 * or fires on its own.
 *
 * Why the service role rather than an admin login: `competition_entry_owners` has an
 * owner-SELECT policy and an admin-INSERT policy but NO admin SELECT (mig 159), because
 * judging is blind. The service role is the only way to resolve an entry to a person —
 * that is the design working as intended, not a hole. Correspondingly, the photographer's
 * name printed by `list` is for YOUR eyes when choosing; it does not travel to the website.
 *
 * Usage:
 *   npm run comp-photos list  [-- --month 2026-07] [--limit 40] [--placed]
 *   npm run comp-photos sheet [-- --month 2026-07] [--limit 40] [--out <dir>]
 *   npm run comp-photos pull  -- <id-or-prefix>... --out <file-or-dir>
 *
 * Needs (from .env.local, loaded automatically):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * NOTE on EXIF: the originals this pulls still carry GPS coordinates and camera serials —
 * nothing in the app's upload path re-encodes them. The website's `npm run optimize` strips
 * all of it (sharp drops metadata unless .withMetadata() is called, and it never is), so
 * publish the assets/optimized/ output and never a raw pull.
 */
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !SR) {
  console.error('✗ Missing env: need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(2)
}

const admin = createClient(URL, SR, { auth: { persistSession: false } })

/** Mirrors bucketFor() in src/lib/competition/types.ts. */
const bucketFor = (mediaType) => (mediaType === 'video' ? 'competition-video' : 'competition-photos')

const THUMB_WIDTH = 400

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const cmd = argv[0]

function flag(name) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
/** Positional args: everything after the command that isn't a --flag or a flag's value. */
function positionals() {
  const out = []
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { i++; continue }
    out.push(argv[i])
  }
  return out
}

/** `--month 2026-07` (or a full 2026-07-01) → the DATE stored in competition_entries.month. */
function monthArg() {
  const m = flag('month')
  if (!m) return undefined
  const match = /^(\d{4})-(\d{2})/.exec(m)
  if (!match) {
    console.error(`✗ --month must look like 2026-07, got "${m}"`)
    process.exit(2)
  }
  return `${match[1]}-${match[2]}-01`
}

const fmtBytes = (n) => (n == null ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.round(n / 1e3)}kB`)
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10) : '—')
const pad = (s, w) => String(s ?? '').padEnd(w).slice(0, w)

// ── data ──────────────────────────────────────────────────────────────────────

/**
 * Entries, newest first, each with the photographer's name resolved through
 * competition_entry_owners → profiles. Two round trips rather than a PostgREST embed:
 * there is no FK from entries to owners in that direction, so the embed isn't available.
 */
async function loadEntries({ month, limit, placedOnly }) {
  let q = admin.from('competition_entries').select('*').order('created_at', { ascending: false })
  if (month) q = q.eq('month', month)
  if (placedOnly) q = q.not('placement', 'is', null)
  if (limit) q = q.limit(limit)

  const { data: entries, error } = await q
  if (error) {
    console.error(`✗ Could not read competition_entries: ${error.message}`)
    process.exit(1)
  }
  if (!entries.length) return []

  const { data: owners } = await admin
    .from('competition_entry_owners')
    .select('entry_id, entrant_id')
    .in('entry_id', entries.map(e => e.id))

  const entrantIds = [...new Set((owners ?? []).map(o => o.entrant_id))]
  const { data: profiles } = entrantIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', entrantIds)
    : { data: [] }

  const nameById = new Map((profiles ?? []).map(p => [p.id, p.full_name]))
  const ownerByEntry = new Map((owners ?? []).map(o => [o.entry_id, o.entrant_id]))

  return entries.map(e => ({
    ...e,
    // winner_name is denormalised onto placed rows at reveal; fall back to it so a
    // legacy row with a broken owner link still shows something useful.
    photographer: nameById.get(ownerByEntry.get(e.id)) ?? e.winner_name ?? '(unknown)',
  }))
}

/** Download one entry's bytes. Service role bypasses the storage SELECT policy. */
async function download(entry) {
  const { data, error } = await admin.storage.from(bucketFor(entry.media_type)).download(entry.storage_path)
  if (error) throw new Error(`${entry.id.slice(0, 8)}: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

/** Match a user-typed id prefix (or a full storage path) to exactly one entry. */
function resolveOne(entries, token) {
  const hits = entries.filter(e => e.id.startsWith(token) || e.storage_path === token)
  if (!hits.length) throw new Error(`no entry matches "${token}"`)
  if (hits.length > 1) throw new Error(`"${token}" matches ${hits.length} entries — use more characters`)
  return hits[0]
}

// ── commands ──────────────────────────────────────────────────────────────────

async function cmdList() {
  const entries = await loadEntries({
    month: monthArg(),
    limit: Number(flag('limit')) || 60,
    placedOnly: argv.includes('--placed'),
  })
  if (!entries.length) return console.log('No entries found.')

  console.log(`\n${pad('id', 10)}${pad('month', 9)}${pad('taken', 11)}${pad('size', 8)}${pad('photographer', 22)}${pad('place', 10)}caption`)
  console.log('─'.repeat(110))
  for (const e of entries) {
    console.log(
      pad(e.id.slice(0, 8), 10) +
      pad(String(e.month).slice(0, 7), 9) +
      pad(fmtDate(e.captured_at ?? e.created_at), 11) +
      pad(fmtBytes(e.size_bytes), 8) +
      pad(e.photographer, 22) +
      pad(e.placement ?? '', 10) +
      (e.caption ?? '')
    )
  }
  console.log(`\n${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}.`)
}

/**
 * Thumbnails + an index, so the photos can be looked at. Videos are listed in the index
 * but skipped — sharp cannot read them and there is no frame-grab dependency here.
 */
async function cmdSheet() {
  const outDir = path.resolve(flag('out') ?? path.join('.', '.competition-sheet'))
  const entries = await loadEntries({
    month: monthArg(),
    limit: Number(flag('limit')) || 40,
    placedOnly: argv.includes('--placed'),
  })
  if (!entries.length) return console.log('No entries found.')

  fs.mkdirSync(outDir, { recursive: true })
  const lines = [`# Competition photos${monthArg() ? ` — ${String(monthArg()).slice(0, 7)}` : ''}`, '']
  let n = 0, skipped = 0

  for (const e of entries) {
    const label = String(++n).padStart(2, '0')
    if (e.media_type === 'video') {
      lines.push(`## ${label} — VIDEO (not thumbnailed)`, `- id \`${e.id.slice(0, 8)}\` · ${e.photographer}`, '')
      skipped++
      continue
    }
    const file = `${label}-${e.id.slice(0, 8)}.jpg`
    try {
      const buf = await download(e)
      // rotate() applies the EXIF orientation so a portrait phone photo isn't sideways.
      await sharp(buf).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 72 }).toFile(path.join(outDir, file))
      const meta = await sharp(buf).metadata()
      lines.push(
        `## ${label} — ${file}`,
        `- id \`${e.id.slice(0, 8)}\` · ${e.photographer} · taken ${fmtDate(e.captured_at ?? e.created_at)}`,
        `- source ${meta.width}×${meta.height} · ${fmtBytes(e.size_bytes)}${e.placement ? ` · ${e.placement}` : ''}`,
        `- caption: ${e.caption || '(none)'}`,
        // The site's carousel hardcodes the -800 variant and the optimizer skips widths
        // above the source, so a narrow photo would 404 silently on gallery.html.
        ...(meta.width && meta.width < 800 ? ['- ⚠ UNDER 800px WIDE — too small for the website gallery'] : []),
        '',
      )
      process.stdout.write(`  ${file}\n`)
    } catch (err) {
      lines.push(`## ${label} — FAILED`, `- ${err.message}`, '')
      skipped++
    }
  }

  fs.writeFileSync(path.join(outDir, 'index.md'), lines.join('\n'), 'utf8')
  console.log(`\n${n - skipped} thumbnail(s) + index.md in ${outDir}`)
}

async function cmdPull() {
  const tokens = positionals()
  const out = flag('out')
  if (!tokens.length || !out) {
    console.error('Usage: npm run comp-photos pull -- <id-prefix>... --out <file-or-dir>')
    process.exit(2)
  }

  const entries = await loadEntries({ limit: 500 })
  const picked = tokens.map(t => resolveOne(entries, t))

  // A single id with a file-shaped --out writes exactly there; otherwise --out is a dir.
  const outIsFile = picked.length === 1 && path.extname(out) !== ''
  if (!outIsFile) fs.mkdirSync(path.resolve(out), { recursive: true })
  else fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })

  for (const e of picked) {
    const buf = await download(e)
    const dest = outIsFile ? path.resolve(out) : path.join(path.resolve(out), e.storage_path)
    fs.writeFileSync(dest, buf)
    const meta = await sharp(buf).metadata().catch(() => ({}))
    console.log(`  ${dest}  (${meta.width ?? '?'}×${meta.height ?? '?'}, ${fmtBytes(buf.length)}, by ${e.photographer})`)
    if (meta.width && meta.width < 800) console.log('    ⚠ under 800px wide — too small for the website gallery')
  }
  console.log('\nOriginal bytes, EXIF intact. Run the website\'s `npm run optimize` before publishing.')
}

const commands = { list: cmdList, sheet: cmdSheet, pull: cmdPull }

if (!commands[cmd]) {
  console.error('Usage:\n  npm run comp-photos list  [-- --month 2026-07] [--limit 40] [--placed]\n  npm run comp-photos sheet [-- --month 2026-07] [--out <dir>]\n  npm run comp-photos pull  -- <id-prefix>... --out <file-or-dir>')
  process.exit(2)
}

commands[cmd]().catch(err => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
