// Client-side read access to synced cargo voyages (Supabase). Clients are
// read-only; RLS restricts rows to voyages whose client_id is their client.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Voyage, CargoPhoto, Period, Camera } from './types'

export interface RemoteVoyageRow {
  id: string
  vessel_name: string | null
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
  voyage_number: string | null
  status: string
  updated_at: string
  synced_at: string
  owner_name: string | null
}

/** All synced voyages across the company (admin RLS returns every row). Note:
 *  voyages a surveyor hasn't synced yet still live only on their device. */
export async function listAllVoyages(supabase: SupabaseClient): Promise<OpsVoyageRow[]> {
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select('id, vessel_name, voyage_number, status, updated_at, synced_at, owner:profiles!owner_id(full_name, display_title)')
    .order('synced_at', { ascending: false })
  if (error) throw error
  return ((data ?? []) as any[]).map(r => ({
    id: r.id,
    vessel_name: r.vessel_name,
    voyage_number: r.voyage_number,
    status: r.status,
    updated_at: r.updated_at,
    synced_at: r.synced_at,
    owner_name: r.owner?.full_name ?? null,
  }))
}

export async function listClientVoyages(supabase: SupabaseClient): Promise<RemoteVoyageRow[]> {
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select('id, vessel_name, voyage_number, status, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as RemoteVoyageRow[]
}

/** Full voyage document + signed photo URLs for the client view. */
export async function getRemoteVoyage(supabase: SupabaseClient, id: string): Promise<{ voyage: Voyage; photos: RemotePhoto[] } | null> {
  const { data: row, error } = await supabase.from('cargo_voyages').select('*').eq('id', id).single()
  if (error || !row) return null

  const voyage = { ...(row.doc as Voyage), id: row.id, status: row.status } as Voyage

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
  return { voyage, photos }
}

/** Fetch the signed photos as blobs and shape them as CargoPhoto[] for the PDF. */
export async function remotePhotosToCargoPhotos(photos: RemotePhoto[], voyageId: string): Promise<CargoPhoto[]> {
  const out: CargoPhoto[] = []
  for (const p of photos) {
    if (!p.url) continue
    try {
      const blob = await (await fetch(p.url)).blob()
      out.push({
        localId: p.id, voyageId, userId: '', dateISO: p.dateISO, period: p.period,
        holdNumber: p.holdNumber, camera: p.camera, actualTime: p.actualTime, filename: p.filename,
        blob, assigned: true, order: 0, createdAt: 0,
      })
    } catch { /* skip unreadable */ }
  }
  return out
}
