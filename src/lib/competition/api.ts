// Staff photo/video competition — browser-side data access (migration 159).
//
// Visibility is enforced by RLS: an entrant sees their own entries + all
// winners; an admin sees every entry but NOT who submitted it (the entrant link
// lives in competition_entry_owners, which the admin can't read). Winner reveal
// + notification is done server-side (service role) via /api/competition/judge.

import { createClient } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
import {
  bucketFor, type CompetitionEntry, type CompetitionRound, type EntryWithUrl,
  type MediaType, type Placement, type RoundStatus,
} from './types'

// 6h — comfortably outlasts a long judging session so thumbnails don't expire
// to broken images mid-review (private buckets; URLs still expire).
const SIGN_TTL = 21600

/** An OPAQUE object key carrying no identity — just a random id + the file
 *  extension. The original filename would otherwise sit in the storage_path (and
 *  the signed image URL), leaking the entrant to a blind judge who inspects the
 *  request. The real filename lives in the `filename` column, which the blind
 *  admin view withholds. */
function opaqueKey(file: File): string {
  const fromName = /\.([a-zA-Z0-9]{1,8})$/.exec(file.name)?.[1]
  const fromType = file.type.split('/')[1]?.replace(/[^a-zA-Z0-9]/g, '')
  const ext = (fromName || fromType || 'bin').toLowerCase()
  return `${crypto.randomUUID()}.${ext}`
}

async function myId(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser()
  return user?.id ?? null
}

/** First day of the current month in Trinidad time, as 'YYYY-MM-01'. Matches the
 *  server-side POS-timezone month the DB trigger stamps on every entry. */
export function currentCompetitionMonth(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Port_of_Spain', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')!.value
  const m = parts.find(p => p.type === 'month')!.value
  return `${y}-${m}-01`
}

/** 'July 2026' from a 'YYYY-MM-01' month key. */
export function monthLabel(month: string): string {
  try { return format(parseISO(month), 'MMMM yyyy') } catch { return month }
}

// ---------------------------------------------------------------------------
// Signed URLs (private buckets — every read needs a fresh signed URL)
// ---------------------------------------------------------------------------

/** Attach a signed thumbnail/preview URL to each entry, batched per bucket. */
export async function withUrls(entries: CompetitionEntry[]): Promise<EntryWithUrl[]> {
  const supabase = createClient()
  const urlByPath = new Map<string, string>()
  for (const type of ['photo', 'video'] as MediaType[]) {
    const paths = entries.filter(e => e.media_type === type).map(e => e.storage_path)
    if (!paths.length) continue
    const { data } = await supabase.storage.from(bucketFor(type)).createSignedUrls(paths, SIGN_TTL)
    for (const row of data ?? []) {
      if (row.path && row.signedUrl) urlByPath.set(row.path, row.signedUrl)
    }
  }
  return entries.map(e => ({ ...e, url: urlByPath.get(e.storage_path) ?? null }))
}

// ---------------------------------------------------------------------------
// Entrant side
// ---------------------------------------------------------------------------

/** The current user's own entries for a month (defaults to this month). */
export async function listMyEntries(month?: string): Promise<CompetitionEntry[]> {
  const uid = await myId()
  if (!uid) return []
  const { data } = await createClient()
    .from('competition_entry_owners')
    .select('entry:competition_entries!inner(*)')
    .eq('entrant_id', uid)
    .order('created_at', { ascending: false })
  const rows = ((data ?? []) as any[]).map(r => r.entry as CompetitionEntry).filter(Boolean)
  return month ? rows.filter(e => e.month === month) : rows
}

/** Best-effort EXIF capture time (lazy exifr — kept out of the initial bundle,
 *  matching the cargo module). Returns an ISO string or null. */
export async function readCapturedAt(file: File): Promise<string | null> {
  try {
    const { default: exifr } = await import('exifr')
    const meta = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'ModifyDate'])
    const d: unknown = meta?.DateTimeOriginal || meta?.CreateDate || meta?.ModifyDate
    if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString()
  } catch { /* no EXIF / unsupported format */ }
  return null
}

export interface UploadResult { entry?: CompetitionEntry; error?: string }

/** Upload one photo/video as a competition entry for the current month. Month is
 *  set server-side (Trinidad tz) — the client can't backdate it.
 *
 *  The entry row and its secret owner link are written by ONE server-side call
 *  (competition_submit_entry, mig 164) so they land together. Doing it as two
 *  inserts from here could not work: an entry is only readable via its owner
 *  link, so `insert(...).select()` — INSERT … RETURNING — was rejected by the
 *  table's own SELECT policy before the link could be written. */
export async function uploadEntry(
  file: File,
  opts: { mediaType?: MediaType; caption?: string | null; capturedAt?: string | null } = {},
): Promise<UploadResult> {
  const supabase = createClient()
  const uid = await myId()
  if (!uid) return { error: 'Not signed in.' }

  const mediaType: MediaType = opts.mediaType ?? 'photo'
  const bucket = bucketFor(mediaType)
  // Opaque key (id + extension only) — no entrant identity, no original
  // filename. Ownership is tracked by the competition_entry_owners link and
  // enforced by storage RLS (mig 160).
  const path = opaqueKey(file)

  // NOTE: single-shot upload. Fine for photos; when video is switched on, large
  // files over marine wifi should move to a resumable (TUS) upload with progress.
  const { error: upErr } = await supabase.storage.from(bucket)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: upErr.message }

  const { data: entry, error: insErr } = await supabase.rpc('competition_submit_entry', {
    p_storage_path: path,
    p_media_type: mediaType,
    p_content_type: file.type || null,
    p_size_bytes: file.size,
    p_filename: file.name,
    p_caption: opts.caption?.trim() || null,
    p_captured_at: opts.capturedAt || null,
  }).single()
  if (insErr || !entry) {
    // Best-effort: the orphan branch in mig 164's storage DELETE policy is what
    // lets this actually remove the bytes we just uploaded.
    await supabase.storage.from(bucket).remove([path])
    return { error: insErr?.message ?? 'Could not save entry.' }
  }

  return { entry: entry as CompetitionEntry }
}

export async function updateCaption(entry: CompetitionEntry, caption: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('competition_entries')
    .update({ caption: caption.trim() || null }).eq('id', entry.id)
  return { error: error?.message }
}

/** Delete one of the current user's own entries (allowed only while the round is
 *  open — RLS enforces it). Removes the stored file too. */
export async function deleteEntry(entry: CompetitionEntry): Promise<{ error?: string }> {
  const supabase = createClient()
  await supabase.storage.from(bucketFor(entry.media_type)).remove([entry.storage_path]).catch(() => {})
  const { error } = await supabase.from('competition_entries').delete().eq('id', entry.id)
  return { error: error?.message }
}

// ---------------------------------------------------------------------------
// Winners (visible to all entrants)
// ---------------------------------------------------------------------------

/** All placed entries (winner + runner-up), newest month first. Each carries the
 *  denormalised winner_name revealed at judging time. */
export async function listWinners(): Promise<CompetitionEntry[]> {
  const { data } = await createClient()
    .from('competition_entries')
    .select('*')
    .not('placement', 'is', null)
    .order('month', { ascending: false })
    .order('placement', { ascending: true }) // 'runner_up' < 'winner' alphabetically; re-sorted in UI
  return (data ?? []) as CompetitionEntry[]
}

// ---------------------------------------------------------------------------
// Rounds (theme + lifecycle)
// ---------------------------------------------------------------------------

export async function getRound(month: string): Promise<CompetitionRound | null> {
  const { data } = await createClient().from('competition_rounds').select('*').eq('month', month).maybeSingle()
  return (data as CompetitionRound) ?? null
}

export async function listRounds(): Promise<CompetitionRound[]> {
  const { data } = await createClient().from('competition_rounds').select('*').order('month', { ascending: false })
  return (data ?? []) as CompetitionRound[]
}

// ---------------------------------------------------------------------------
// Admin side (judging). Entries here carry NO entrant identity — blind by design.
// ---------------------------------------------------------------------------

/** Every entry for a month, in submission order. Admin-only via RLS. Blind:
 *  filename and caption are deliberately NOT selected — a filename like
 *  "john_selfie.jpg" (or a self-identifying caption) would leak the entrant to
 *  a judge, so the blind view never loads them. */
export async function adminListEntries(month: string): Promise<CompetitionEntry[]> {
  const { data } = await createClient()
    .from('competition_entries')
    .select('id, month, media_type, storage_path, content_type, size_bytes, captured_at, placement, placed_at, winner_name, created_at')
    .eq('month', month)
    .order('created_at', { ascending: true })
  return ((data ?? []) as any[]).map(e => ({ ...e, filename: null, caption: null })) as CompetitionEntry[]
}

/** The set of entry ids the current admin submitted themselves — used to flag
 *  "your own entry" in the judging view so they can recuse. Reads the owner link
 *  scoped to their own uid (the only rows RLS lets them see there). */
export async function myOwnEntryIds(): Promise<Set<string>> {
  const uid = await myId()
  if (!uid) return new Set()
  const { data } = await createClient()
    .from('competition_entry_owners').select('entry_id').eq('entrant_id', uid)
  return new Set(((data ?? []) as any[]).map(r => r.entry_id as string))
}

export interface Entrant { id: string; full_name: string; role: string }

/** Staff eligible to enter (admin/surveyor/office, active). Mirrors
 *  listStaffForLeave — used by the admin "upload on behalf" picker. */
export async function listEntrants(): Promise<Entrant[]> {
  const { data } = await createClient()
    .from('profiles').select('id, full_name, role')
    .in('role', ['admin', 'surveyor', 'office'])
    .eq('is_active', true)
    .order('full_name', { ascending: true })
  return (data ?? []) as Entrant[]
}

/** Admin uploads a photo/video ON BEHALF of a staff member (e.g. one they were
 *  sent over WhatsApp). Stored under an opaque key like any other entry (mig
 *  160 — the path must not encode who submitted it) and attributed via the
 *  owner link, so it shows up in their "My Photos". An optional month lets the
 *  admin file it into a specific past round; otherwise it lands in this month. */
export async function adminUploadOnBehalf(
  file: File,
  entrantId: string,
  opts: { mediaType?: MediaType; caption?: string | null; capturedAt?: string | null; month?: string | null } = {},
): Promise<UploadResult> {
  const supabase = createClient()
  const mediaType: MediaType = opts.mediaType ?? 'photo'
  const bucket = bucketFor(mediaType)
  // Opaque key (see uploadEntry) — no entrant id, no filename in the path.
  const path = opaqueKey(file)

  const { error: upErr } = await supabase.storage.from(bucket)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: upErr.message }

  const row: Record<string, any> = {
    media_type: mediaType,
    storage_path: path,
    content_type: file.type || null,
    size_bytes: file.size,
    filename: file.name,
    caption: opts.caption?.trim() || null,
    captured_at: opts.capturedAt || null,
  }
  if (opts.month) row.month = opts.month // admin-only; the trigger honours it
  // NB: the .select() here is INSERT … RETURNING, which is checked against the
  // table's SELECT policy. It only passes because is_admin() is the first read
  // arm. If this tool is ever opened to non-admins it must move to an RPC that
  // writes the entry + owner link together, the way uploadEntry does (mig 164).
  const { data: entry, error: insErr } = await supabase.from('competition_entries').insert(row).select('*').single()
  if (insErr || !entry) {
    await supabase.storage.from(bucket).remove([path]).catch(() => {})
    return { error: insErr?.message ?? 'Could not save entry.' }
  }

  const { error: ownErr } = await supabase.from('competition_entry_owners')
    .insert({ entry_id: (entry as CompetitionEntry).id, entrant_id: entrantId })
  if (ownErr) {
    await supabase.from('competition_entries').delete().eq('id', (entry as CompetitionEntry).id)
    await supabase.storage.from(bucket).remove([path]).catch(() => {})
    return { error: ownErr.message }
  }

  return { entry: entry as CompetitionEntry }
}

export interface MonthSummary { month: string; entries: number; judged: boolean; status: RoundStatus }

/** Months that have entries, newest first, with counts + whether judged. */
export async function listMonthSummaries(): Promise<MonthSummary[]> {
  const supabase = createClient()
  const [{ data: entryRows }, { data: rounds }] = await Promise.all([
    supabase.from('competition_entries').select('month, placement'),
    supabase.from('competition_rounds').select('month, status'),
  ])
  const statusByMonth = new Map<string, RoundStatus>()
  for (const r of (rounds ?? []) as any[]) statusByMonth.set(r.month, r.status)
  const agg = new Map<string, { entries: number; judged: boolean }>()
  for (const e of (entryRows ?? []) as any[]) {
    const cur = agg.get(e.month) ?? { entries: 0, judged: false }
    cur.entries += 1
    if (e.placement) cur.judged = true
    agg.set(e.month, cur)
  }
  return Array.from(agg.entries())
    .map(([month, v]) => ({ month, entries: v.entries, judged: v.judged, status: statusByMonth.get(month) ?? 'open' as RoundStatus }))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
}

export interface StaffRosterEntry { entrantId: string; name: string; count: number; coverUrl: string | null }

/** Super-admin only: every staff member who has entered, with a photo count and
 *  a cover thumbnail. Non-blind — served by the service-role roster route. */
export async function adminListStaffRoster(): Promise<StaffRosterEntry[]> {
  const res = await fetch('/api/competition/roster')
  if (!res.ok) return []
  const json = await res.json().catch(() => ({}))
  return (json.people ?? []) as StaffRosterEntry[]
}

/** Super-admin only: one staff member's entries across all months, with signed
 *  URLs. Newest month first. */
export async function adminStaffEntries(entrantId: string): Promise<EntryWithUrl[]> {
  const res = await fetch(`/api/competition/roster?entrantId=${encodeURIComponent(entrantId)}`)
  if (!res.ok) return []
  const json = await res.json().catch(() => ({}))
  return (json.entries ?? []) as EntryWithUrl[]
}

/** Admin: set (or clear) the theme + lifecycle status for a month. Upserts the
 *  round row. */
export async function saveRound(month: string, patch: { theme?: string | null; status?: RoundStatus }): Promise<{ error?: string }> {
  const uid = await myId()
  const row: Record<string, any> = { month }
  if (patch.theme !== undefined) row.theme = patch.theme?.trim() || null
  if (patch.status !== undefined) {
    row.status = patch.status
    row.closed_at = patch.status === 'closed' ? new Date().toISOString() : null
  }
  if (uid) row.created_by = uid
  const { error } = await createClient().from('competition_rounds')
    .upsert(row, { onConflict: 'month' })
  return { error: error?.message }
}

/** Admin: lock the winner + runner-up for a month. Goes through the service-role
 *  route so it can read the (otherwise hidden) entrant links, stamp the winners,
 *  and email + in-app-notify them. Passing an empty object clears placements. */
export async function savePlacements(
  month: string, picks: { winnerId?: string | null; runnerUpId?: string | null },
): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch('/api/competition/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month, ...picks }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json?.error ?? 'Could not save the results.' }
  return { ok: true }
}
