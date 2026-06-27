import { openDB, type IDBPDatabase, type DBSchema } from 'idb'
import { draftKey, type OfflineDraft, type QueuedPhoto } from './types'

/** Cached data needed to START a new job fully offline (one row, key 'data'). */
export interface CachedNewJobData {
  templates: any[] // active, surveyor-startable templates incl. sections + fields
  clients: any[]
  cachedAt: number
}

interface OfflineSchema extends DBSchema {
  drafts: { key: string; value: OfflineDraft }
  photos: { key: string; value: QueuedPhoto; indexes: { 'by-job': string } }
  newjobcache: { key: string; value: CachedNewJobData }
}

let dbPromise: Promise<IDBPDatabase<OfflineSchema>> | null = null

export function offlineAvailable(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function getDB(): Promise<IDBPDatabase<OfflineSchema>> {
  if (!offlineAvailable()) return Promise.reject(new Error('Offline storage is not available on this device.'))
  if (!dbPromise) {
    dbPromise = openDB<OfflineSchema>('tayeng-offline', 3, {
      // Version-aware so later upgrades never wipe existing drafts/photos.
      upgrade(db, oldVersion) {
        // v2 reshaped draft keys to `${userId}::${jobId}` — only rebuild when
        // coming from v1, otherwise keep the user's pending drafts intact.
        if (oldVersion > 0 && oldVersion < 2 && db.objectStoreNames.contains('drafts')) {
          db.deleteObjectStore('drafts')
        }
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'localId' })
          store.createIndex('by-job', 'jobId')
        }
        // v3: cache for starting new jobs offline.
        if (!db.objectStoreNames.contains('newjobcache')) {
          db.createObjectStore('newjobcache')
        }
      },
    })
  }
  return dbPromise
}

// --- New-job cache (templates + clients + surveyors for offline creation) ---
export async function cacheNewJobData(data: CachedNewJobData): Promise<void> {
  await (await getDB()).put('newjobcache', data, 'data')
}
export async function getCachedNewJobData(): Promise<CachedNewJobData | undefined> {
  return (await getDB()).get('newjobcache', 'data')
}

/** Drafts for jobs started locally that aren't on the server yet (this user). */
export async function getLocalCreateDrafts(userId: string): Promise<OfflineDraft[]> {
  const all = await (await getDB()).getAll('drafts')
  return all.filter(d => d.userId === userId && d.pendingCreate)
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

/** A user's drafts with OFFLINE work to push (never online local-cache autosaves). */
export async function getPendingDrafts(userId: string): Promise<OfflineDraft[]> {
  const all = await (await getDB()).getAll('drafts')
  return all.filter(d => d.userId === userId && (d.needsSync || d.pendingSubmit))
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
