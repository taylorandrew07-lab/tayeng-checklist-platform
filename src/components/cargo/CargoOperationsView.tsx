'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Ship, Loader2, Cloud, ListOrdered, Trash2 } from 'lucide-react'
import { CargoStatusPill } from '@/components/job/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import type { VoyageStatus } from '@/lib/cargo/types'
import { createClient } from '@/lib/supabase/client'
import { listAllVoyages, type OpsVoyageRow } from '@/lib/cargo/remote'
import { deleteRemoteVoyage } from '@/lib/cargo/sync'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { withTimeout } from '@/lib/utils'

/** Company-wide, cloud-backed view of every voyage surveyors have SYNCED.
 *  Distinct from the device-local list below it: this is the real operational
 *  picture (with owners), so an admin no longer mistakes one device's voyages
 *  for the whole company's. Unsynced work still lives only on a surveyor's
 *  device until they sync. Each row drills into the read-only cloud voyage. */
export default function CargoOperationsView() {
  const [rows, setRows] = useState<OpsVoyageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const data = await listAllVoyages(createClient())
        if (active) setRows(data)
      } catch (e: any) {
        if (active) setError(e?.message ?? 'Could not load voyages.')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  // Remove a synced voyage from the cloud (blobs + row, photos cascade). Admins
  // have FOR ALL on cargo_voyages (mig 028), so this is RLS-permitted. NB it only
  // removes the CLOUD copy — the owning surveyor's device copy is untouched and
  // would re-publish on their next sync, so the confirm says so.
  async function handleDelete(r: OpsVoyageRow) {
    const name = `M.V. ${r.vessel_name || '—'}${r.voyage_number ? ` — ${r.voyage_number}` : ''}`
    const jobNote = r.job_id ? ' It will also be unlinked from its job (the job and its billing are not deleted).' : ''
    const ok = await confirmDialog({
      title: 'Delete voyage',
      message: `Delete ${name} and all its photos from Cargo Monitoring? This revokes client access and cannot be undone.${jobNote} The surveyor's own device copy is not affected — if they sync again it will reappear here.`,
      danger: true,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    setDeleting(r.id)
    try {
      await withTimeout(deleteRemoteVoyage(createClient(), r.id), 15_000, 'Deleting voyage')
      setRows(prev => prev.filter(x => x.id !== r.id))
      toast.success('Voyage deleted')
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not delete the voyage — please try again.')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Cargo Monitoring</h1>
          <p className="text-gray-500 mt-0.5">Company-wide view of every voyage surveyors have synced to the cloud.</p>
        </div>
        <Link href="/admin/cargo/register" className="btn-secondary flex-shrink-0"><ListOrdered className="h-4 w-4" />Report register</Link>
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14 w-full" />)}</div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Cloud} title="No synced voyages yet" description="Surveyor voyages appear here once they sync." />
      ) : (
        <div className="card p-0 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2.5 font-medium">Vessel / Voyage</th>
                <th className="px-4 py-2.5 font-medium">Surveyor</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Job</th>
                <th className="px-4 py-2.5 font-medium">Last synced</th>
                <th className="px-4 py-2.5 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/cargo/cloud/${r.id}`} className="group flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <Ship className="h-4 w-4 text-brand-600" />
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-gray-900 group-hover:text-brand-700 block truncate">M.V. {r.vessel_name || '—'}</span>
                        <span className="text-xs text-gray-500 block truncate">{r.voyage_number || 'No voyage no.'}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.owner_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <CargoStatusPill status={r.status as VoyageStatus} />
                  </td>
                  <td className="px-4 py-3">
                    {r.job_id
                      ? <Link href={`/admin/jobs/${r.job_id}`} className="text-brand-700 hover:underline tnum">{r.job_number ?? 'View job'}</Link>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 tnum">{formatWhen(r.synced_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(r)}
                      disabled={deleting === r.id}
                      className="p-1.5 text-gray-400 transition-colors hover:text-red-600 disabled:opacity-50"
                      aria-label={`Delete voyage ${r.vessel_name || ''}`.trim()}
                    >
                      {deleting === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}
