import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { draftKey, type OfflineDraft, type QueuedPhoto } from './types'

interface OfflineSchema extends DBSchema {
  drafts: { key: string; value: OfflineDraft }
  photos: { key: string; value: QueuedPhoto; indexes: { 'by-job': string } }
}

let dbPromise: Promise<IDBPDatabase<OfflineSchema>> | null = null

export function offlineAvailable(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function getDB(): Promise<IDBPDatabase<OfflineSchema>> {
  if (!offlineAvailable()) return Promise.reject(new Error('Offline storage is not available on this device.'))
  if (!dbPromise) {
    dbPromise = openDB<OfflineSchema>('tayeng-offline', 2, {
      upgrade(db) {
        // v2: drafts keyed by `${userId}::${jobId}` so users on one device can't collide.
        if (db.objectStoreNames.contains('drafts')) db.deleteObjectStore('drafts')
        db.createObjectStore('drafts', { keyPath: 'key' })
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'localId' })
          store.createIndex('by-job', 'jobId')
        }
      },
    })
  }
  return dbPromise
}

/** Ask the browser not to evict our data under storage pressure. Best-effort. */
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

// --- Drafts (always scoped by userId) ---
export async function getDraft(userId: string, jobId: string): Promise<OfflineDraft | undefined> {
  return (await getDB()).get('drafts', draftKey(userId, jobId))
}

/** Persist a draft. Throws on failure so explicit saves can surface the error. */
export async function putDraft(draft: OfflineDraft): Promise<void> {
  await (await getDB()).put('drafts', { ...draft, key: draftKey(draft.userId, draft.jobId) })
}

/** All of a user's drafts that still need syncing (dirty or a queued submit). */
export async function getPendingDrafts(userId: string): Promise<OfflineDraft[]> {
  const all = await (await getDB()).getAll('drafts')
  return all.filter(d => d.userId === userId && (d.dirty || d.pendingSubmit))
}

export async function deleteDraft(userId: string, jobId: string): Promise<void> {
  const db = await getDB()
  await db.delete('drafts', draftKey(userId, jobId))
  const photos = await db.getAllFromIndex('photos', 'by-job', jobId)
  const tx = db.transaction('photos', 'readwrite')
  for (const p of photos) if (p.userId === userId) tx.store.delete(p.localId)
  await tx.done
}

// --- Queued photos (phase 2) ---
export async function putPhoto(photo: QueuedPhoto): Promise<void> {
  await (await getDB()).put('photos', photo)
}

export async function getPhotosForJob(userId: string, jobId: string): Promise<QueuedPhoto[]> {
  const all = await (await getDB()).getAllFromIndex('photos', 'by-job', jobId)
  return all.filter(p => p.userId === userId)
}

export async function deletePhoto(localId: string): Promise<void> {
  await (await getDB()).delete('photos', localId)
}
