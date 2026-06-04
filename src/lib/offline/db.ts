import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import type { OfflineDraft, QueuedPhoto } from './types'

interface OfflineSchema extends DBSchema {
  drafts: { key: string; value: OfflineDraft }
  photos: { key: string; value: QueuedPhoto; indexes: { 'by-job': string } }
}

let dbPromise: Promise<IDBPDatabase<OfflineSchema>> | null = null

export function offlineAvailable(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function getDB(): Promise<IDBPDatabase<OfflineSchema>> {
  if (!offlineAvailable()) return Promise.reject(new Error('IndexedDB not available'))
  if (!dbPromise) {
    dbPromise = openDB<OfflineSchema>('tayeng-offline', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'jobId' })
        }
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

// --- Drafts ---
export async function getDraft(jobId: string): Promise<OfflineDraft | undefined> {
  return (await getDB()).get('drafts', jobId)
}

export async function putDraft(draft: OfflineDraft): Promise<void> {
  await (await getDB()).put('drafts', draft)
}

export async function deleteDraft(jobId: string): Promise<void> {
  const db = await getDB()
  await db.delete('drafts', jobId)
  const photos = await db.getAllFromIndex('photos', 'by-job', jobId)
  const tx = db.transaction('photos', 'readwrite')
  for (const p of photos) tx.store.delete(p.localId)
  await tx.done
}

// --- Queued photos ---
export async function putPhoto(photo: QueuedPhoto): Promise<void> {
  await (await getDB()).put('photos', photo)
}

export async function getPhotosForJob(jobId: string): Promise<QueuedPhoto[]> {
  return (await getDB()).getAllFromIndex('photos', 'by-job', jobId)
}

export async function deletePhoto(localId: string): Promise<void> {
  await (await getDB()).delete('photos', localId)
}
