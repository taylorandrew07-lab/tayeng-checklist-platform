// Vessels directory — first-class vessel records (migration 057) that jobs and
// cargo voyages link to via vessel_id. vessel_name stays as a historical snapshot.

import { createClient } from '@/lib/supabase/client'
import { parseVesselName, splitVoyageFromVesselName, type VesselPrefix } from '@/lib/utils'
import { byLastDateDesc } from '@/lib/jobs/jobDate'

export interface Vessel {
  id: string
  name: string
  imo: string | null
  official_number: string | null
  is_active: boolean
  /** 'M.V.' (Motor Vessel) or 'M.T.' (Motor Tanker) — see migration 167. */
  vessel_type: VesselPrefix
  created_at: string
}

export interface VesselRow extends Vessel { jobs: number }

// Drives BOTH listVessels and getVesselDetail — omitting a column here makes the
// field silently undefined at runtime with no type error (both cast through `any`).
const COLS = 'id, name, imo, official_number, is_active, vessel_type, created_at'

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
  patch: Partial<Pick<Vessel, 'name' | 'imo' | 'official_number' | 'is_active' | 'vessel_type'>>,
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
 *  "DELTA TITAN" / "delta titan" / "Delta Titan" as separate vessels.
 *
 *  `typedPrefix` is the prefix the user actually typed (from parseVesselName), and
 *  is the durable half of "typing M.T. tells the app it's a tanker". Callers that
 *  still hold the RAW string can omit it — the prefix is re-read off `name` — but
 *  the three call sites that pass an already-title-cased name must pass it
 *  explicitly, because by then the token is gone.
 *
 *  Upgrade rule: an EXISTING vessel is only re-typed when the user explicitly typed
 *  a different prefix. Absent input never overwrites the directory's record, so
 *  creating a second job on a known tanker without typing "M.T." does not demote it. */
export async function findOrCreateVessel(
  name: string,
  typedPrefix?: VesselPrefix | null,
): Promise<string | null> {
  // Strip any voyage a caller still has inside the name ("Chaconia (V086)"). This
  // function matches on the WHOLE name, so without it every voyage creates its own
  // vessel row and the directory accumulates one bogus vessel per trip. It is the last
  // line of defence — jobs.voyage_number is captured upstream (see
  // splitVoyageFromVesselName in the forms and createDraftJob) — but it is the one
  // every caller passes through.
  const parsed = parseVesselName(splitVoyageFromVesselName(name).name)
  const n = parsed.name
  if (!n) return null
  const prefix = typedPrefix ?? parsed.prefix
  const supabase = createClient()
  const { data: existing } = await supabase
    .from('vessels').select('id, vessel_type').ilike('name', n).limit(1)
  if (existing && existing.length) {
    const row = existing[0] as { id: string; vessel_type: VesselPrefix }
    if (prefix && prefix !== row.vessel_type) {
      // Explicit correction — the trigger from mig 167 propagates it to this
      // vessel's existing jobs, voyages and stored job titles.
      await supabase.from('vessels').update({ vessel_type: prefix }).eq('id', row.id)
    }
    return row.id
  }
  const { data: ins, error } = await supabase
    .from('vessels').insert({ name: n, vessel_type: prefix ?? 'M.V.' }).select('id').single()
  if (error) return null
  return ins?.id ?? null
}

export interface VesselJob {
  id: string; report_number: string | null; title: string
  workflow_status: string; scheduled_date: string | null; end_date: string | null; created_at: string
}
export interface VesselVoyage { id: string; voyage_number: string | null; status: string; updated_at: string }
export interface VesselDetail { vessel: Vessel; jobs: VesselJob[]; voyages: VesselVoyage[] }

export async function getVesselDetail(id: string): Promise<VesselDetail | null> {
  const supabase = createClient()
  const [{ data: vessel }, { data: jobs }, { data: voyages }] = await Promise.all([
    supabase.from('vessels').select(COLS).eq('id', id).single(),
    supabase.from('jobs').select('id, report_number, title, workflow_status, scheduled_date, end_date, created_at').eq('vessel_id', id).order('created_at', { ascending: false }),
    supabase.from('cargo_voyages').select('id, voyage_number, status, updated_at').eq('vessel_id', id).order('updated_at', { ascending: false }),
  ])
  if (!vessel) return null
  // Re-sorted by the job's LAST day (PostgREST can't ORDER BY a COALESCE), matching
  // every other job list.
  return {
    vessel: vessel as Vessel,
    jobs: ((jobs ?? []) as VesselJob[]).sort(byLastDateDesc),
    voyages: (voyages ?? []) as VesselVoyage[],
  }
}
