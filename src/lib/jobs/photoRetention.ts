// Photo retention: job photos in Supabase storage are a working copy; the long-term
// archive is the Synology NAS (linked per line). Photos older than RETENTION_MONTHS
// are eligible for cleanup — but deletion is NEVER automatic: an admin reviews the
// eligible set in Settings and confirms before anything is removed.
import { createClient } from '@/lib/supabase/client'

export const RETENTION_MONTHS = 12

function cutoffISO(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - RETENTION_MONTHS)
  return d.toISOString()
}

export interface ExpiredPhotosSummary {
  count: number
  oldestDate: string | null
  jobs: { jobId: string | null; title: string | null; reportNumber: string | null; count: number }[]
}

/** Job photos older than the retention window, summarised by job (for the review UI). */
export async function getExpiredJobPhotos(): Promise<ExpiredPhotosSummary> {
  const { data } = await createClient()
    .from('job_photos')
    .select('id, job_id, created_at, job:jobs(title, report_number)')
    .lt('created_at', cutoffISO())
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as any[]
  const byJob = new Map<string, { jobId: string | null; title: string | null; reportNumber: string | null; count: number }>()
  for (const r of rows) {
    const key = r.job_id ?? '—'
    const cur = byJob.get(key)
    if (cur) cur.count++
    else byJob.set(key, { jobId: r.job_id ?? null, title: r.job?.title ?? null, reportNumber: r.job?.report_number ?? null, count: 1 })
  }
  return {
    count: rows.length,
    oldestDate: rows[0]?.created_at ?? null,
    jobs: [...byJob.values()].sort((a, b) => b.count - a.count),
  }
}

/** Delete every job photo older than the retention window (storage objects + rows).
 *  Call only after explicit admin confirmation. */
export async function deleteExpiredJobPhotos(): Promise<{ deleted: number; error?: string }> {
  const supabase = createClient()
  const iso = cutoffISO()
  const { data, error } = await supabase.from('job_photos').select('id, storage_path').lt('created_at', iso)
  if (error) return { deleted: 0, error: error.message }
  const rows = (data ?? []) as { id: string; storage_path: string }[]
  if (rows.length === 0) return { deleted: 0 }

  // Remove storage objects in batches (the API caps how many paths per call).
  const paths = rows.map(r => r.storage_path).filter(Boolean)
  for (let i = 0; i < paths.length; i += 100) {
    const { error: rmErr } = await supabase.storage.from('job-photos').remove(paths.slice(i, i + 100))
    if (rmErr) return { deleted: 0, error: rmErr.message }
  }
  // Then the rows (by id, so a photo uploaded during cleanup isn't swept up).
  for (let i = 0; i < rows.length; i += 200) {
    const ids = rows.slice(i, i + 200).map(r => r.id)
    const { error: delErr } = await supabase.from('job_photos').delete().in('id', ids)
    if (delErr) return { deleted: i, error: delErr.message }
  }
  return { deleted: rows.length }
}
