import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { bucketFor, type MediaType } from '@/lib/competition/types'

// Super-admin-only, NON-blind roster. Reveals who submitted what — the exact
// thing the blind judging RLS hides — so it runs as the service role and is
// gated on is_super_admin here (the browser client can never read the
// entry→entrant link). Two modes:
//   GET /api/competition/roster            → { people: [{ entrantId, name, count, coverUrl }] }
//   GET /api/competition/roster?entrantId= → { entrantId, name, entries: [entry + url] }

const SIGN_TTL = 21600

async function signAll(db: ReturnType<typeof createServiceClient>, rows: { storage_path: string; media_type: MediaType }[]): Promise<Map<string, string>> {
  const urlByPath = new Map<string, string>()
  for (const type of ['photo', 'video'] as MediaType[]) {
    const paths = rows.filter(r => r.media_type === type).map(r => r.storage_path)
    if (!paths.length) continue
    const { data } = await db.storage.from(bucketFor(type)).createSignedUrls(paths, SIGN_TTL)
    for (const s of data ?? []) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
  }
  return urlByPath
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: me } = await supabase.from('profiles').select('is_active, is_super_admin').eq('id', user.id).single()
  if (!me?.is_active || me.is_super_admin !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = createServiceClient()
  const entrantId = new URL(request.url).searchParams.get('entrantId')

  // --- One person's photos (all months) ---
  if (entrantId) {
    const { data: links } = await db.from('competition_entry_owners').select('entry_id').eq('entrant_id', entrantId)
    const entryIds = ((links ?? []) as any[]).map(l => l.entry_id)
    const { data: prof } = await db.from('profiles').select('full_name').eq('id', entrantId).single()
    if (!entryIds.length) return NextResponse.json({ entrantId, name: prof?.full_name ?? 'Unknown', entries: [] })
    const { data: entries } = await db.from('competition_entries').select('*')
      .in('id', entryIds).order('month', { ascending: false }).order('created_at', { ascending: false })
    const rows = (entries ?? []) as any[]
    const urls = await signAll(db, rows)
    return NextResponse.json({
      entrantId, name: prof?.full_name ?? 'Unknown',
      entries: rows.map(e => ({ ...e, url: urls.get(e.storage_path) ?? null })),
    })
  }

  // --- People summary (name + count + a cover thumbnail) ---
  const { data: allEntries } = await db.from('competition_entries')
    .select('id, media_type, storage_path, created_at').order('created_at', { ascending: false })
  const rows = (allEntries ?? []) as any[]
  if (!rows.length) return NextResponse.json({ people: [] })

  const { data: links } = await db.from('competition_entry_owners').select('entry_id, entrant_id')
  const ownerByEntry = new Map<string, string>()
  for (const l of (links ?? []) as any[]) ownerByEntry.set(l.entry_id, l.entrant_id)

  // Group by entrant, remembering the most-recent entry as the cover (rows are
  // already newest-first).
  const agg = new Map<string, { count: number; cover: { storage_path: string; media_type: MediaType } | null }>()
  for (const e of rows) {
    const eid = ownerByEntry.get(e.id)
    if (!eid) continue
    const cur = agg.get(eid) ?? { count: 0, cover: null }
    cur.count += 1
    if (!cur.cover) cur.cover = { storage_path: e.storage_path, media_type: e.media_type }
    agg.set(eid, cur)
  }

  const entrantIds = Array.from(agg.keys())
  const nameById = new Map<string, string>()
  if (entrantIds.length) {
    const { data: profs } = await db.from('profiles').select('id, full_name').in('id', entrantIds)
    for (const p of (profs ?? []) as any[]) nameById.set(p.id, p.full_name ?? 'Unknown')
  }
  const covers = await signAll(db, Array.from(agg.values()).map(v => v.cover).filter(Boolean) as any[])

  const people = entrantIds.map(id => ({
    entrantId: id,
    name: nameById.get(id) ?? 'Unknown',
    count: agg.get(id)!.count,
    coverUrl: agg.get(id)!.cover ? (covers.get(agg.get(id)!.cover!.storage_path) ?? null) : null,
  })).sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ people })
}
