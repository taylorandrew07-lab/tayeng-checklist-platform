// Offline draft + queued-photo shapes stored in IndexedDB. Everything here is
// browser-local; it is synced to Supabase by the normal logged-in user client.

export interface OfflineDraft {
  /** Primary key: `${userId}::${jobId}` so users on one device never collide. */
  key: string
  jobId: string
  /** Auth user the draft belongs to — a different user must never read/sync it. */
  userId: string
  /** Cached job snapshot (status, title, template_id, …) from the last online load. */
  job: any
  /** Cached template_sections (each with its fields) from the last online load. */
  sections: any[]
  values: Record<string, string>
  arrayValues: Record<string, string[]>
  signatures: Record<string, string>
  /** Cached server photo metadata so offline submit validation isn't fooled. */
  fieldPhotos: Record<string, any[]>
  generalPhotos: any[]
  /** Baseline as last loaded from the server — used to detect concurrent edits. */
  serverValues: Record<string, string>
  serverArrayValues: Record<string, string[]>
  serverSignatures: Record<string, string>
  /** True once the surveyor has hit Submit offline — applied to the server on sync. */
  pendingSubmit: boolean
  dirty: boolean
  updatedAt: number
  lastSyncedAt: number | null
  syncError: string | null
}

export interface QueuedPhoto {
  /** Stable client id — also the storage-path segment + idempotency key on sync. */
  localId: string
  jobId: string
  userId: string
  fieldId: string | null
  filename: string
  /** Stamped/compressed image bytes to upload. */
  blob: Blob
  capturedAt: string
  gpsLat: number | null
  gpsLng: number | null
  gpsAccuracyM: number | null
  uploaded: boolean
  storagePath: string | null
  error: string | null
  createdAt: number
}

export function draftKey(userId: string, jobId: string): string {
  return `${userId}::${jobId}`
}
