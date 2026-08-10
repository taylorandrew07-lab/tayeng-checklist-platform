// Pull a synced voyage back DOWN from Supabase onto this device.
//
// Sync is push-only by design — the surveyor's device owns the document and we
// only ever publish it upward (see sync.ts). The gap that left: if the local
// copy goes (storage cleared, a different browser, a replaced machine), the
// voyage is safe in the cloud but the surveyor cannot resume working on it.
// getRemoteVoyage() could already read one and putVoyage() could already write
// one; nothing joined them. This does.
//
// Photos come down with it, and that is not optional. pushVoyage() deletes any
// server photo row that is no longer present locally — so restoring the document
// alone and then syncing would wipe every photo off the server. Either the whole
// voyage comes back or none of it does.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Voyage, CargoPhoto, Period, Camera } from './types'
import { getVoyage, putVoyage, putPhotos } from './db'
import { voyageDirty } from './sync'

export interface RestorableVoyage {
  id: string
  vesselName: string | null
  voyageNumber: string | null
  status: string
  syncedAt: string
  photoCount: number
}

/** Voyages of THIS user that are in the cloud but not on this device. RLS
 *  ("Owners manage own cargo_voyages") already restricts the rows to their own,
 *  so an explicit owner filter is belt-and-braces rather than the gate. */
export async function listRestorable(
  supabase: SupabaseClient, userId: string, localIds: string[]
): Promise<RestorableVoyage[]> {
  const { data, error } = await supabase
    .from('cargo_voyages')
    .select('id, vessel_name, voyage_number, status, synced_at, cargo_voyage_photos(count)')
    .eq('owner_id', userId)
    .order('synced_at', { ascending: false })
  if (error) throw error

  const local = new Set(localIds)
  return ((data ?? []) as any[])
    .filter(r => !local.has(r.id))
    .map(r => ({
      id: r.id,
      vesselName: r.vessel_name,
      voyageNumber: r.voyage_number,
      status: r.status,
      syncedAt: r.synced_at,
      photoCount: r.cargo_voyage_photos?.[0]?.count ?? 0,
    }))
}

export interface RestoreResult { voyage: Voyage; photos: number }

/**
 * Restore one voyage (document + photos) to this device.
 *
 * Refuses to overwrite a local copy carrying unsynced edits — the same rule
 * syncDraft() follows for checklists. Pulling the server copy over work that has
 * never been published would destroy the only copy of it.
 */
export async function restoreVoyage(
  supabase: SupabaseClient, userId: string, voyageId: string,
  opts: { onProgress?: (done: number, total: number) => void; force?: boolean } = {}
): Promise<RestoreResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new Error('You are offline — connect to the internet to restore a voyage.')
  }

  const existing = await getVoyage(userId, voyageId)
  if (existing && voyageDirty(existing) && !opts.force) {
    throw new Error('This voyage is already on this device with changes that have not synced. Sync it first, or those changes would be overwritten.')
  }

  const { data: row, error } = await supabase
    .from('cargo_voyages').select('id, status, doc').eq('id', voyageId).maybeSingle()
  if (error) throw error
  if (!row?.doc) throw new Error('That voyage could not be found in the cloud.')

  const { data: photoRows, error: pErr } = await supabase
    .from('cargo_voyage_photos').select('*').eq('voyage_id', voyageId).order('ordinal')
  if (pErr) throw pErr
  const rows = photoRows ?? []

  // Signed URLs are minted in one call and are short-lived, so download promptly.
  const paths = rows.map((p: any) => p.storage_path).filter(Boolean)
  const urls = new Map<string, string>()
  if (paths.length) {
    const { data: signed } = await supabase.storage.from('cargo-photos').createSignedUrls(paths, 3600)
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl)
  }

  const photos: CargoPhoto[] = []
  for (let i = 0; i < rows.length; i++) {
    const p: any = rows[i]
    const url = urls.get(p.storage_path)
    opts.onProgress?.(i, rows.length)
    if (!url) continue
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Could not download photo ${i + 1} of ${rows.length}. Nothing was changed on this device.`)
    photos.push({
      localId: p.id, voyageId, userId,
      dateISO: p.date_iso, period: p.period as Period,
      holdNumber: p.hold_number, camera: p.camera as Camera,
      actualTime: p.actual_time, filename: p.filename,
      blob: await res.blob(),
      assigned: true, order: p.ordinal ?? i, createdAt: p.ordinal ?? i,
      // Already in Storage — recorded so the next push neither re-uploads them
      // nor treats them as locally deleted.
      uploaded: true, storagePath: p.storage_path,
    } as CargoPhoto)
  }
  opts.onProgress?.(rows.length, rows.length)

  // Adopt the voyage onto THIS device and user. lastSyncedAt is stamped from the
  // document's own updatedAt so the restored copy starts clean rather than
  // immediately looking like it has unsynced changes.
  const doc = row.doc as Voyage
  const voyage: Voyage = {
    ...doc,
    id: row.id,
    userId,
    status: (row.status as Voyage['status']) ?? doc.status,
    lastSyncedAt: doc.updatedAt ?? Date.now(),
  }

  // Photos first: if writing them fails, the voyage never appears half-restored.
  if (photos.length) await putPhotos(photos)
  await putVoyage(voyage)

  return { voyage, photos: photos.length }
}
