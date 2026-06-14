// Push cargo voyages from the device to Supabase. The device is the source of
// truth (surveyors edit offline); we only PUSH. Clients read the pushed rows.
// Runs whenever the staff user is online. Idempotent and retry-safe.

import type { SupabaseClient } from '@supabase/supabase-js'
import { listVoyages, getVoyage, getPhotosForVoyage, putPhoto, markVoyageSynced } from './db'
import { findOrCreateVessel } from '@/lib/vessels/api'
import type { Voyage, CargoPhoto } from './types'

export function voyageDirty(v: Voyage): boolean {
  return (v.updatedAt ?? 0) > (v.lastSyncedAt ?? 0)
}

/** Push one voyage: upload any not-yet-uploaded assigned photos, sync the photo
 *  rows (incl. deletions), then upsert the voyage document. */
export async function pushVoyage(supabase: SupabaseClient, voyage: Voyage, photos: CargoPhoto[]): Promise<void> {
  const rev = voyage.updatedAt ?? 0
  const assigned = photos.filter(p => p.assigned && p.holdNumber != null && p.camera != null)

  // Link to the vessels directory (create on first use) so the voyage shows on the
  // vessel record. Best-effort — never block a sync if it fails.
  const vesselId = voyage.vesselName?.trim() ? await findOrCreateVessel(voyage.vesselName.trim()).catch(() => null) : null

  // 1. Upsert the voyage document FIRST — it's the FK target for photo rows and
  //    the row the storage RLS checks (ownership) when photos upload.
  const { error: vErr } = await supabase.from('cargo_voyages').upsert({
    id: voyage.id,
    owner_id: voyage.userId,
    client_id: voyage.clientId ?? null,
    vessel_name: voyage.vesselName,
    vessel_id: vesselId,
    voyage_number: voyage.voyageNumber,
    status: voyage.status ?? 'in_progress',
    synced_at: new Date().toISOString(), // refresh on every push (default only stamps the insert)
    doc: voyage,
  })
  if (vErr) throw vErr

  // 2. Upload blobs that aren't in Storage yet.
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

  // 3. Upsert photo metadata rows.
  const rows = assigned.map(p => ({
    id: p.localId, voyage_id: voyage.id, owner_id: voyage.userId, storage_path: p.storagePath,
    date_iso: p.dateISO, period: p.period, hold_number: p.holdNumber, camera: p.camera,
    actual_time: p.actualTime, filename: p.filename, ordinal: p.order,
  }))
  if (rows.length) {
    const { error } = await supabase.from('cargo_voyage_photos').upsert(rows)
    if (error) throw error
  }

  // 4. Remove server rows for photos deleted/unassigned locally.
  const ids = assigned.map(p => p.localId)
  let del = supabase.from('cargo_voyage_photos').delete().eq('voyage_id', voyage.id)
  if (ids.length) del = del.not('id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`)
  const { error: delErr } = await del
  if (delErr) throw delErr

  await markVoyageSynced(voyage.userId, voyage.id, rev)
}

/** Remove a voyage from the cloud (storage blobs + row, which cascades photo
 *  rows). Used when a synced voyage is deleted so clients lose access. Throws if
 *  the row delete fails (e.g. offline) so callers can keep the local copy. */
export async function deleteRemoteVoyage(supabase: SupabaseClient, id: string): Promise<void> {
  const { data: prows } = await supabase.from('cargo_voyage_photos').select('storage_path').eq('voyage_id', id)
  const paths = (prows ?? []).map((r: { storage_path: string }) => r.storage_path).filter(Boolean)
  if (paths.length) await supabase.storage.from('cargo-photos').remove(paths).catch(() => { /* row delete still revokes access */ })
  const { error } = await supabase.from('cargo_voyages').delete().eq('id', id)
  if (error) throw error
}

/** Push a single voyage and throw on failure — used for explicit "Sync now" so
 *  the surveyor sees the real error instead of a silent background retry. */
export async function syncVoyage(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('You are offline — connect to the internet to sync.')
  const voyage = await getVoyage(userId, id)
  if (!voyage) return
  const photos = await getPhotosForVoyage(userId, id)
  await pushVoyage(supabase, voyage, photos)
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
