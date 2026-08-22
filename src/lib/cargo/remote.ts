// Client-side read access to synced cargo voyages (Supabase). Clients are
// read-only; RLS restricts rows to voyages whose client_id is their client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Voyage, CargoPhoto, Period, Camera } from './types'
import type { VesselPrefix } from '@/lib/utils'
import { applyCorrections, type CorrectionPatch, type CorrectionLogEntry } from './corrections'

export interface RemoteVoyageRow {
  id: string
  vessel_name: string | null
  vessel_type: VesselPrefix | null
  voyage_number: string | null
  status: string
  updated_at: string
}

export interface RemotePhoto {
  id: string
  dateISO: string
  period: Period
  holdNumber: number
  camera: Camera
  actualTime: string | null
  filename: string
  url: string
}

/** Admin/office company-wide ops row: every SYNCED voyage with its owner. */
export interface OpsVoyageRow {
  id: string
  vessel_name: string | null
  vessel_type: VesselPrefix | null
  voyage_number: string | null
  status: string
  updated_at: string
  synced_at: string
  owner_name: string | null
  /** Linked job (billing), null until staff attach the voyage to a job. */
  job_id: string | null
  job_number: string | null
}

/** All synced voyages across the company (admin RLS returns every row). Note:
 *  voyages a surveyor hasn't synced yet still live only on their device. */
export async function listAllVoyages(supabase: SupabaseClient): Promise<OpsVoyageRow[]> {
  // Job linkage embeds directly — job_id + the jobs FK have existed since mig 085
  // (long applied), so the earlier separate best-effort query is no longer needed.
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select('id, vessel_name, vessel_type, voyage_number, status, updated_at, synced_at, job_id, owner:profiles!owner_id(full_name, display_title), job:jobs!cargo_voyages_job_id_fkey(job_number)')
    .order('synced_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as any[]).map(r => ({
    id: r.id,
    vessel_name: r.vessel_name,
    vessel_type: r.vessel_type ?? null,
    voyage_number: r.voyage_number,
    status: r.status,
    updated_at: r.updated_at,
    synced_at: r.synced_at,
    owner_name: r.owner?.full_name ?? null,
    job_id: r.job_id ?? null,
    job_number: r.job?.job_number ?? null,
  }))
}

/** A synced voyage as shown in the job-page "Cargo voyages" picker/list. */
export interface LinkedVoyageRow {
  id: string
  vessel_name: string | null
  vessel_type: VesselPrefix | null
  voyage_number: string | null
  status: string
  owner_name: string | null
}

function toLinkedRow(r: any): LinkedVoyageRow {
  return {
    id: r.id,
    vessel_name: r.vessel_name,
    vessel_type: r.vessel_type ?? null,
    voyage_number: r.voyage_number,
    status: r.status,
    owner_name: r.owner?.full_name ?? null,
  }
}

/** Synced voyages attached to a given job (its billable cargo work). */
export async function listVoyagesForJob(supabase: SupabaseClient, jobId: string): Promise<LinkedVoyageRow[]> {
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select('id, vessel_name, vessel_type, voyage_number, status, owner:profiles!owner_id(full_name)')
    .eq('job_id', jobId)
    .order('synced_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as any[]).map(toLinkedRow)
}

/** Synced voyages not yet attached to any job — the attach picker's options. */
export async function listUnlinkedVoyages(supabase: SupabaseClient): Promise<LinkedVoyageRow[]> {
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select('id, vessel_name, vessel_type, voyage_number, status, owner:profiles!owner_id(full_name)')
    .is('job_id', null)
    .order('synced_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as any[]).map(toLinkedRow)
}

/** Attach a voyage to a job (or pass null to detach). Staff-only via RLS. */
export async function setVoyageJob(supabase: SupabaseClient, voyageId: string, jobId: string | null): Promise<void> {
  const { error } = await supabase.from('cargo_voyages').update({ job_id: jobId }).eq('id', voyageId)
  if (error) throw error
}

/** A synced voyage as it appears in the jobs registers, alongside jobs. */
export interface VoyageListRow {
  id: string
  vessel_name: string | null
  vessel_type: VesselPrefix | null
  voyage_number: string | null
  status: string
  /** From doc.startDate / doc.endDate. endDate is '' while open-ended — see
   *  lib/cargo/voyageDate.ts, which is the only thing that should interpret them. */
  start_date: string | null
  end_date: string | null
  surveyor_name: string | null
  client_name: string | null
  client_color: string | null
  /** Set once staff attach the voyage to a job for billing (migration 085).
   *  A linked voyage is shown ON its job's row rather than as its own. */
  job_id: string | null
  job_number: string | null
  created_at: string
  updated_at: string
}

/**
 * Synced voyages for the jobs registers and dashboards.
 *
 * No owner/status filter — RLS scopes the rows (admin: all · office with
 * cargo.view: all · surveyor: their own). Critically this does NOT select `doc`:
 * that column holds every reading of the voyage and can run to hundreds of KB a
 * row. The two dates are lifted out of it with PostgREST arrow paths instead, so
 * a list of fifty voyages stays a few KB.
 */
export async function listVoyageListRows(supabase: SupabaseClient): Promise<VoyageListRow[]> {
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select(
      'id, vessel_name, vessel_type, voyage_number, status, created_at, updated_at, job_id,' +
      ' start_date:doc->>startDate, end_date:doc->>endDate, surveyor_name:doc->>surveyorName,' +
      ' owner:profiles!owner_id(full_name), client:clients(name, color),' +
      ' job:jobs!cargo_voyages_job_id_fkey(job_number)'
    )
    .order('synced_at', { ascending: false })
  if (error) throw error

  return ((data ?? []) as any[]).map(r => ({
    id: r.id,
    vessel_name: r.vessel_name,
    vessel_type: r.vessel_type ?? null,
    voyage_number: r.voyage_number,
    status: r.status,
    // '' means "not set yet" in the document; normalise it here so no caller has
    // to know that and accidentally treat the empty string as a real date.
    start_date: r.start_date || null,
    end_date: r.end_date || null,
    // The document's own surveyor name is what the report shows; the profile is
    // the fallback for a voyage saved before that field was filled in.
    surveyor_name: r.surveyor_name || r.owner?.full_name?.trim() || null,
    client_name: r.client?.name ?? null,
    client_color: r.client?.color ?? null,
    job_id: r.job_id ?? null,
    job_number: r.job?.job_number ?? null,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))
}

export async function listClientVoyages(supabase: SupabaseClient): Promise<RemoteVoyageRow[]> {
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select('id, vessel_name, vessel_type, voyage_number, status, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as RemoteVoyageRow[]
}

/** Full voyage document + signed photo URLs for the client view. */
export async function getRemoteVoyage(supabase: SupabaseClient, id: string): Promise<{ voyage: Voyage; photos: RemotePhoto[]; patch: CorrectionPatch | null } | null> {
  const { data: row, error } = await supabase.from('cargo_voyages').select('*').eq('id', id).single()
  if (error || !row) return null

  // THE single cloud reader of a voyage document — so applying the super admin's
  // corrections here fixes the admin view, the office view, the client view, both
  // PDF paths, the DRI builder and the report register in one place.
  // Best-effort: a corrections read that fails must never hide the voyage.
  const { data: cor } = await supabase
    .from('cargo_voyage_corrections').select('patch').eq('voyage_id', id).maybeSingle()
  const patch = (cor?.patch as CorrectionPatch | undefined) ?? null

  const base = { ...(row.doc as Voyage), id: row.id, status: row.status } as Voyage
  const voyage = applyCorrections(base, patch)

  const { data: prows } = await supabase
    .from('cargo_voyage_photos').select('*').eq('voyage_id', id).order('ordinal')
  const photoRows = prows ?? []

  const urlMap = new Map<string, string>()
  const paths = photoRows.map((p: any) => p.storage_path).filter(Boolean)
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('cargo-photos').createSignedUrls(paths, 3600)
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl)
  }

  const photos: RemotePhoto[] = photoRows.map((p: any) => ({
    id: p.id, dateISO: p.date_iso, period: p.period as Period, holdNumber: p.hold_number,
    camera: p.camera as Camera, actualTime: p.actual_time, filename: p.filename,
    url: urlMap.get(p.storage_path) ?? '',
  }))
  return { voyage, photos, patch }
}

/** Fetch the signed photos as blobs and shape them as CargoPhoto[] for the PDF. */
export async function remotePhotosToCargoPhotos(photos: RemotePhoto[], voyageId: string): Promise<CargoPhoto[]> {
  const out: CargoPhoto[] = []
  // `photos` arrives ordered by ordinal (getRemoteVoyage orders by it). Preserve that
  // order on `order`/`createdAt` so anything that sorts photos (e.g. the DRI report
  // plate) keeps the surveyor's intended sequence instead of collapsing to one value.
  let i = 0
  for (const p of photos) {
    if (!p.url) continue
    try {
      const blob = await (await fetch(p.url)).blob()
      out.push({
        localId: p.id, voyageId, userId: '', dateISO: p.dateISO, period: p.period,
        holdNumber: p.holdNumber, camera: p.camera, actualTime: p.actualTime, filename: p.filename,
        blob, assigned: true, order: i, createdAt: i,
      })
      i++
    } catch { /* skip unreadable */ }
  }
  return out
}

// ── super-admin corrections (mig 195) ───────────────────────────────────────

/** The correction patch for a voyage, or null. Readable by anyone who can read
 *  the voyage; only a super admin may write (enforced in the database). */
export async function getCorrections(supabase: SupabaseClient, voyageId: string): Promise<CorrectionPatch | null> {
  const { data, error } = await supabase
    .from('cargo_voyage_corrections').select('patch').eq('voyage_id', voyageId).maybeSingle()
  if (error) return null
  return (data?.patch as CorrectionPatch | undefined) ?? null
}

/**
 * Write the patch, appending to the audit log.
 *
 * The log matters more here than it would elsewhere: the client is shown the
 * corrected value with no marker, by decision, so this is the only record of what
 * was changed and by whom. Read-modify-write of the log is safe because there is
 * exactly one writer — the super admin.
 */
export async function saveCorrections(
  supabase: SupabaseClient, voyageId: string, patch: CorrectionPatch, entries: CorrectionLogEntry[]
): Promise<void> {
  const { data: existing } = await supabase
    .from('cargo_voyage_corrections').select('log').eq('voyage_id', voyageId).maybeSingle()
  const log = [...((existing?.log as CorrectionLogEntry[] | undefined) ?? []), ...entries]
  const { data: { user } } = await supabase.auth.getUser()

  const { error } = await supabase.from('cargo_voyage_corrections')
    .upsert({ voyage_id: voyageId, patch, log, corrected_by: user?.id ?? null }, { onConflict: 'voyage_id' })
  // Surfaced, not swallowed: a correction that silently failed to save is the
  // same class of bug as one silently overwritten.
  if (error) throw error
}
