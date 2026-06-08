// Push cargo voyages from the device to Supabase. The device is the source of
// truth (surveyors edit offline); we only PUSH. Clients read the pushed rows.
// Runs whenever the staff user is online. Idempotent and retry-safe.

import type { SupabaseClient } from '@supabase/supabase-js'
import { listVoyages, getPhotosForVoyage, putPhoto, markVoyageSynced } from './db'
import type { Voyage, CargoPhoto } from './types'

export function voyageDirty(v: Voyage): boolean {
  return (v.updatedAt ?? 0) > (v.lastSyncedAt ?? 0)
}

/** Push one voyage: upload any not-yet-uploaded assigned photos, sync the photo
 *  rows (incl. deletions), then upsert the voyage document. */
export async function pushVoyage(supabase: SupabaseClient, voyage: Voyage, photos: CargoPhoto[]): Promise<void> {
  const rev = voyage.updatedAt ?? 0
  const assigned = photos.filter(p => p.assigned && p.holdNumber != null && p.camera != null)

  // 1. Upload blobs that aren't in Storage yet.
  for (const p of assigned) {
    if (p.uploaded && p.storagePath) continue
    const path = `${voyage.id}/${p.localId}.jpg`
    const { error } = await supabase.storage.from('cargo-photos')
      .upload(path, p.blob, { contentType: p.blob.type || 'image/jpeg', upsert: true })
    if (error) throw error
    p.storagePath = path
    p.uploaded = true
    await putPhoto(p)
  }

  // 2. Upsert photo metadata rows.
  const rows = assigned.map(p => ({
    id: p.localId, voyage_id: voyage.id, owner_id: voyage.userId, storage_path: p.storagePath,
    date_iso: p.dateISO, period: p.period, hold_number: p.holdNumber, camera: p.camera,
    actual_time: p.actualTime, filename: p.filename, ordinal: p.order,
  }))
  if (rows.length) {
    const { error } = await supabase.from('cargo_voyage_photos').upsert(rows)
    if (error) throw error
  }

  // 3. Remove server rows for photos deleted/unassigned locally.
  const ids = assigned.map(p => p.localId)
  let del = supabase.from('cargo_voyage_photos').delete().eq('voyage_id', voyage.id)
  if (ids.length) del = del.not('id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`)
  const { error: delErr } = await del
  if (delErr) throw delErr

  // 4. Upsert the voyage document.
  const { error: vErr } = await supabase.from('cargo_voyages').upsert({
    id: voyage.id,
    owner_id: voyage.userId,
    client_id: voyage.clientId ?? null,
    vessel_name: voyage.vesselName,
    voyage_number: voyage.voyageNumber,
    status: voyage.status ?? 'in_progress',
    doc: voyage,
  })
  if (vErr) throw vErr

  await markVoyageSynced(voyage.userId, voyage.id, rev)
}

export interface CargoSyncResult { pushed: number; failed: number }

/** Push every voyage that has local changes or un-uploaded photos. */
export async function syncAllCargo(supabase: SupabaseClient, userId: string): Promise<CargoSyncResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { pushed: 0, failed: 0 }
  const voyages = await listVoyages(userId)
  let pushed = 0, failed = 0
  for (const v of voyages) {
    const photos = await getPhotosForVoyage(userId, v.id)
    const pendingPhotos = photos.some(p => p.assigned && !p.uploaded)
    if (!voyageDirty(v) && !pendingPhotos) continue
    try { await pushVoyage(supabase, v, photos); pushed++ }
    catch { failed++ }
  }
  return { pushed, failed }
}
