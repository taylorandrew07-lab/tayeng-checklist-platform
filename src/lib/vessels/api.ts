// Vessels directory — first-class vessel records (migration 057) that jobs and
// cargo voyages link to via vessel_id. vessel_name stays as a historical snapshot.

import { createClient } from '@/lib/supabase/client'
import { titleCaseVesselName } from '@/lib/utils'

export interface Vessel {
  id: string
  name: string
  imo: string | null
  official_number: string | null
  is_active: boolean
  created_at: string
}

export interface VesselRow extends Vessel { jobs: number }

const COLS = 'id, name, imo, official_number, is_active, created_at'

/** All vessels with a job count (one extra query, tallied in JS). */
export async function listVessels(): Promise<VesselRow[]> {
  const supabase = createClient()
  const [{ data: vessels }, { data: jobs }] = await Promise.all([
    supabase.from('vessels').select(COLS).order('name'),
    supabase.from('jobs').select('vessel_id'),
  ])
  const counts = new Map<string, number>()
  for (const j of (jobs ?? []) as any[]) if (j.vessel_id) counts.set(j.vessel_id, (counts.get(j.vessel_id) ?? 0) + 1)
  return ((vessels ?? []) as any[]).map(v => ({ ...v, jobs: counts.get(v.id) ?? 0 }))
}

export async function updateVessel(
  id: string,
  patch: Partial<Pick<Vessel, 'name' | 'imo' | 'official_number' | 'is_active'>>,
): Promise<{ error?: string }> {
  const { error } = await createClient().from('vessels').update(patch).eq('id', id)
  return { error: error?.message }
}

/** Permanently delete a vessel (admin). Linked jobs/cargo voyages are unlinked
 *  (vessel_id → NULL) and keep their vessel_name snapshot; the vessel's
 *  document-library rows cascade-delete, so we first remove their storage blobs
 *  (best-effort) to avoid orphaning files in the bucket. */
export async function deleteVessel(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: docs } = await supabase.from('vessel_documents').select('storage_path').eq('vessel_id', id)
  const paths = ((docs ?? []) as any[]).map(d => d.storage_path).filter(Boolean)
  if (paths.length) { try { await supabase.storage.from('vessel-documents').remove(paths) } catch { /* clean up rows anyway */ } }
  const { error } = await supabase.from('vessels').delete().eq('id', id)
  return { error: error?.message }
}

/** Find a vessel by exact (case-insensitive) name, or create it. Returns the id.
 *  Used by the job/cargo pickers to link + snapshot in one step. The name is
 *  standardised to canonical Title Case first so the directory never accumulates
 *  "DELTA TITAN" / "delta titan" / "Delta Titan" as separate vessels. */
export async function findOrCreateVessel(name: string): Promise<string | null> {
  const n = titleCaseVesselName(name)
  if (!n) return null
  const supabase = createClient()
  const { data: existing } = await supabase.from('vessels').select('id').ilike('name', n).limit(1)
  if (existing && existing.length) return existing[0].id
  const { data: ins, error } = await supabase.from('vessels').insert({ name: n }).select('id').single()
  if (error) return null
  return ins?.id ?? null
}

export interface VesselJob {
  id: string; report_number: string | null; title: string
  workflow_status: string; scheduled_date: string | null; created_at: string
}
export interface VesselVoyage { id: string; voyage_number: string | null; status: string; updated_at: string }
export interface VesselDetail { vessel: Vessel; jobs: VesselJob[]; voyages: VesselVoyage[] }

export async function getVesselDetail(id: string): Promise<VesselDetail | null> {
  const supabase = createClient()
  const [{ data: vessel }, { data: jobs }, { data: voyages }] = await Promise.all([
    supabase.from('vessels').select(COLS).eq('id', id).single(),
    supabase.from('jobs').select('id, report_number, title, workflow_status, scheduled_date, created_at').eq('vessel_id', id).order('created_at', { ascending: false }),
    supabase.from('cargo_voyages').select('id, voyage_number, status, updated_at').eq('vessel_id', id).order('updated_at', { ascending: false }),
  ])
  if (!vessel) return null
  return { vessel: vessel as Vessel, jobs: (jobs ?? []) as VesselJob[], voyages: (voyages ?? []) as VesselVoyage[] }
}
