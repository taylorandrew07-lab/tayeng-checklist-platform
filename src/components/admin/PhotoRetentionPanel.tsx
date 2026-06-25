'use client'

// Admin "photo storage cleanup": surfaces job photos older than the retention window
// and deletes them ONLY after the admin confirms. Originals live on the Synology NAS
// (linked per line); Supabase is just the working copy.

import { useState, useEffect } from 'react'
import { Loader2, Trash2, ImageOff } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { formatDate } from '@/lib/utils'
import { getExpiredJobPhotos, deleteExpiredJobPhotos, RETENTION_MONTHS, type ExpiredPhotosSummary } from '@/lib/jobs/photoRetention'

export default function PhotoRetentionPanel() {
  const [summary, setSummary] = useState<ExpiredPhotosSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try { setSummary(await getExpiredJobPhotos()) } catch { /* best effort */ } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  async function cleanup() {
    if (!summary || summary.count === 0) return
    const ok = await confirmDialog({
      title: `Delete ${summary.count} old photo${summary.count === 1 ? '' : 's'}?`,
      message: `Permanently delete ${summary.count} photo${summary.count === 1 ? '' : 's'} older than ${RETENTION_MONTHS} months from Supabase. Reports keep all their text; the photos remain on the Synology NAS via each line's link. This cannot be undone.`,
      confirmLabel: 'Delete photos',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    const res = await deleteExpiredJobPhotos()
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(`Deleted ${res.deleted} photo${res.deleted === 1 ? '' : 's'}`)
    void load()
  }

  return (
    <div className="card p-5">
      <h3 className="font-medium text-gray-900 mb-1">Photo storage cleanup</h3>
      <p className="text-xs text-gray-400 mb-3">
        Job photos older than {RETENTION_MONTHS} months can be cleared from Supabase to save storage — the originals stay on the Synology NAS (linked per line). Nothing is deleted automatically; you review and confirm here.
      </p>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
      ) : !summary || summary.count === 0 ? (
        <p className="text-sm text-gray-500 flex items-center gap-2"><ImageOff className="h-4 w-4 text-gray-300" />No photos older than {RETENTION_MONTHS} months.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            <strong>{summary.count}</strong> photo{summary.count === 1 ? '' : 's'} across <strong>{summary.jobs.length}</strong> job{summary.jobs.length === 1 ? '' : 's'} are older than {RETENTION_MONTHS} months{summary.oldestDate ? ` (oldest ${formatDate(summary.oldestDate)})` : ''}.
          </p>
          <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
            {summary.jobs.map(j => (
              <div key={j.jobId ?? '—'} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="text-gray-700 truncate">{j.reportNumber ? `${j.reportNumber} · ` : ''}{j.title ?? 'Untitled job'}</span>
                <span className="text-gray-400 tnum flex-shrink-0 ml-2">{j.count}</span>
              </div>
            ))}
          </div>
          <button onClick={cleanup} disabled={busy} className="btn-secondary text-sm text-red-600 hover:bg-red-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete {summary.count} photo{summary.count === 1 ? '' : 's'} older than {RETENTION_MONTHS} months
          </button>
        </div>
      )}
    </div>
  )
}
