'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Ship, Loader2, ChevronRight, CheckCircle2, CircleDot } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listClientVoyages, type RemoteVoyageRow } from '@/lib/cargo/remote'

// Office cargo list. RLS (migration 062, 'cargo.view') decides which synced
// voyages are returned. Office issues DRI reports from the cloud copy, so the
// list query is the same basic projection clients use.
export default function OfficeCargoListPage() {
  const [voyages, setVoyages] = useState<RemoteVoyageRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    listClientVoyages(createClient())
      .then(rows => { if (active) setVoyages(rows) })
      .catch(() => { /* none / no access */ })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Cargo Reports</h1>
        <p className="text-gray-500 mt-0.5">Synced cargo voyages. Open one to generate the DRI Production Report (PDF/.docx). Read-only — figures update as the surveyor syncs.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : voyages.length === 0 ? (
        <div className="card p-12 text-center">
          <Ship className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No synced cargo voyages yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {voyages.map(v => {
            const finalized = v.status === 'finalized'
            return (
              <Link key={v.id} href={`/office/cargo/${v.id}`} className="card p-4 flex items-center gap-4 hover:bg-gray-50">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Ship className="h-5 w-5 text-brand-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">M.V. {v.vessel_name} — {v.voyage_number}</p>
                  <p className="text-sm text-gray-500">Updated {v.updated_at?.slice(0, 10)}</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${finalized ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                  {finalized ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDot className="h-3.5 w-3.5" />}
                  {finalized ? 'Finalised' : 'In progress'}
                </span>
                <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
