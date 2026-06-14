'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listReportRegister, type RegisterEntry } from '@/lib/cargo/register'

/** Register of issued DRI Production Reports (admin + office). Read-only list. */
export default function ReportRegister({ backHref, voyageHrefBase }: { backHref: string; voyageHrefBase: string }) {
  const [rows, setRows] = useState<RegisterEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    listReportRegister(createClient())
      .then(r => { if (active) setRows(r) })
      .catch(() => { /* none / no access */ })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-4">
        <Link href={backHref} className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="page-title">DRI report register</h1>
          <p className="text-gray-500 mt-0.5 text-sm">Official report numbers issued for cargo voyages, newest first.</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : rows.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No report numbers issued yet.</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2.5 font-semibold">Report no.</th>
                <th className="px-4 py-2.5 font-semibold">Vessel</th>
                <th className="px-4 py-2.5 font-semibold">Voyage</th>
                <th className="px-4 py-2.5 font-semibold">Issued</th>
                <th className="px-4 py-2.5 font-semibold">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-brand-700">{r.report_number}</td>
                  <td className="px-4 py-2.5 text-gray-800">
                    {r.voyage_id ? (
                      <Link href={`${voyageHrefBase}/${r.voyage_id}`} className="hover:underline">{r.vessel_name || '—'}</Link>
                    ) : (r.vessel_name || '—')}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{r.voyage_number || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-600 tnum">{r.issued_at?.slice(0, 10)}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.issued_by_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
