'use client'

import { useEffect, useState } from 'react'
import { Ship, Loader2, Cloud, CheckCircle2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listAllVoyages, type OpsVoyageRow } from '@/lib/cargo/remote'

/** Company-wide, cloud-backed view of every voyage surveyors have SYNCED.
 *  Distinct from the device-local list below it: this is the real operational
 *  picture (with owners), so an admin no longer mistakes one device's voyages
 *  for the whole company's. Unsynced work still lives only on a surveyor's
 *  device until they sync. Read-only for now; drill-in lands in a later phase. */
export default function CargoOperationsView() {
  const [rows, setRows] = useState<OpsVoyageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="page-title">Cargo Operations</h1>
        <p className="text-gray-500 mt-0.5">Company-wide view of every voyage surveyors have synced to the cloud.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-brand-600" /></div>
      ) : error ? (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <Cloud className="h-9 w-9 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No synced voyages yet. Surveyor voyages appear here once they sync.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2.5 font-medium">Vessel / Voyage</th>
                <th className="px-4 py-2.5 font-medium">Surveyor</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Last synced</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                        <Ship className="h-4 w-4 text-brand-600" />
                      </span>
                      <span className="min-w-0">
                        <span className="font-medium text-gray-900 block truncate">M.V. {r.vessel_name || '—'}</span>
                        <span className="text-xs text-gray-500 block truncate">{r.voyage_number || 'No voyage no.'}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{r.owner_name ?? '—'}</td>
                  <td className="px-4 py-3">
                    {r.status === 'finalized' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
                        <CheckCircle2 className="h-3 w-3" />Finalized
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                        In progress
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 tnum">{formatWhen(r.synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function formatWhen(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}
