// IndexedDB layer for the Cargo Monitoring module. Mirrors the structure of
// src/lib/offline/db.ts but in its own database (`tayeng-cargo`) so the checklist
// offline path is never touched. Voyages and photos are scoped by `userId`. The
// `templates` store is intentionally a GLOBAL cache of admin-published active
// templates (not user-private data) — it just mirrors what the server already
// exposes to any staff user, for offline voyage creation.

import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { normalizeVoyage, type Voyage, type CargoPhoto, type CargoTemplate } from './types'

/** Cached client/surveyor pick lists (single row, key 'lists'). */
export interface CachedPickLists {
  key: string
  clients: { id: string; name: string }[]
  surveyors: { name: string }[]
}

interface CargoSchema extends DBSchema {
  voyages: { key: string; value: Voyage; indexes: { 'by-user': string } }
  cargoPhotos: { key: string; value: CargoPhoto; indexes: { 'by-voyage': string } }
  templates: { key: string; value: CargoTemplate }
  picklists: { key: string; value: CachedPickLists }
}

let dbPromise: Promise<IDBPDatabase<CargoSchema>> | null = null

export function cargoAvailable(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function getDB(): Promise<IDBPDatabase<CargoSchema>> {
  if (!cargoAvailable()) return Promise.reject(new Error('Offline storage is not available on this device.'))
  if (!dbPromise) {
    dbPromise = openDB<CargoSchema>('tayeng-cargo', 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('voyages')) {
          const v = db.createObjectStore('voyages', { keyPath: 'id' })
          v.createIndex('by-user', 'userId')
        }
        if (!db.objectStoreNames.contains('cargoPhotos')) {
          const p = db.createObjectStore('cargoPhotos', { keyPath: 'localId' })
          p.createIndex('by-voyage', 'voyageId')
        }
        // v2: cache of admin cargo templates for offline voyage creation.
        if (!db.objectStoreNames.contains('templates')) {
          db.createObjectStore('templates', { keyPath: 'id' })
        }
        // v3: cache of client/surveyor pick lists for offline voyage setup.
        if (!db.objectStoreNames.contains('picklists')) {
          db.createObjectStore('picklists', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

/** Best-effort: ask the browser not to evict our data under storage pressure. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* ignore */
  }
  return false
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate()
      return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
    }
  } catch {
    /* ignore */
  }
  return null
}

/** Collision-resistant id for client-generated records. */
export function newId(prefix: string): string {
  const rnd = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}_${rnd}`
}

// --- Voyages ---
export async function getVoyage(userId: string, id: string): Promise<Voyage | undefined> {
  const v = await (await getDB()).get('voyages', id)
  return v && v.userId === userId ? normalizeVoyage(v) : undefined
}

export async function listVoyages(userId: string): Promise<Voyage[]> {
  const all = await (await getDB()).getAllFromIndex('voyages', 'by-user', userId)
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function putVoyage(voyage: Voyage): Promise<void> {
  await (await getDB()).put('voyages', { ...voyage, updatedAt: Date.now() })
}

/** Advance a voyage's lastSyncedAt to the revision we pushed, without clobbering
 *  edits made during the sync (re-reads the current record first). */
export async function markVoyageSynced(userId: string, id: string, pushedUpdatedAt: number): Promise<void> {
  const db = await getDB()
  const cur = await db.get('voyages', id)
  if (!cur || cur.userId !== userId) return
  await db.put('voyages', { ...cur, lastSyncedAt: Math.max(cur.lastSyncedAt ?? 0, pushedUpdatedAt) })
}

export async function deleteVoyage(userId: string, id: string): Promise<void> {
  const db = await getDB()
  const voyage = await db.get('voyages', id)
  if (!voyage || voyage.userId !== userId) return
  await db.delete('voyages', id)
  const photos = await db.getAllFromIndex('cargoPhotos', 'by-voyage', id)
  const tx = db.transaction('cargoPhotos', 'readwrite')
  for (const p of photos) tx.store.delete(p.localId)
  await tx.done
}

// --- Photos ---
export async function putPhoto(photo: CargoPhoto): Promise<void> {
  await (await getDB()).put('cargoPhotos', photo)
}

/** Write several photo records in a single transaction (all-or-nothing). */
export async function putPhotos(photos: CargoPhoto[]): Promise<void> {
  if (!photos.length) return
  const db = await getDB()
  const tx = db.transaction('cargoPhotos', 'readwrite')
  for (const p of photos) tx.store.put(p)
  await tx.done
}

export async function getPhotosForVoyage(userId: string, voyageId: string): Promise<CargoPhoto[]> {
  const all = await (await getDB()).getAllFromIndex('cargoPhotos', 'by-voyage', voyageId)
  return all.filter(p => p.userId === userId).sort((a, b) => a.order - b.order)
}

export async function deletePhoto(localId: string): Promise<void> {
  await (await getDB()).delete('cargoPhotos', localId)
}

// --- Cached cargo templates (refreshed from Supabase when online) ---
export async function cacheTemplates(templates: CargoTemplate[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('templates', 'readwrite')
  await tx.store.clear()
  for (const t of templates) tx.store.put(t)
  await tx.done
}

export async function getCachedTemplates(): Promise<CargoTemplate[]> {
  const all = await (await getDB()).getAll('templates')
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

// --- Cached pick lists (clients + surveyor names) ---
export async function cachePickLists(clients: { id: string; name: string }[], surveyors: { name: string }[]): Promise<void> {
  await (await getDB()).put('picklists', { key: 'lists', clients, surveyors })
}

export async function getCachedPickLists(): Promise<{ clients: { id: string; name: string }[]; surveyors: { name: string }[] }> {
  const row = await (await getDB()).get('picklists', 'lists')
  return { clients: row?.clients ?? [], surveyors: row?.surveyors ?? [] }
}
