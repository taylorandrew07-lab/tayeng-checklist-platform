'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Ship, Loader2, ChevronRight } from 'lucide-react'
import { CargoStatusPill } from '@/components/job/StatusPill'
import type { VoyageStatus } from '@/lib/cargo/types'
import { createClient } from '@/lib/supabase/client'
import { listClientVoyages, type RemoteVoyageRow } from '@/lib/cargo/remote'

export default function ClientCargoListPage() {
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
        <h1 className="page-title">Cargo Monitoring</h1>
        <p className="text-gray-500 mt-0.5">Live monitoring reports shared with you. Read-only; figures update as the surveyor syncs.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : voyages.length === 0 ? (
        <div className="card p-12 text-center">
          <Ship className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No cargo monitoring reports have been shared with you yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {voyages.map(v => {
            return (
              <Link key={v.id} href={`/client/cargo/${v.id}`} className="card p-4 flex items-center gap-4 hover:bg-gray-50">
                <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center flex-shrink-0">
                  <Ship className="h-5 w-5 text-brand-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">M.V. {v.vessel_name} — {v.voyage_number}</p>
                  <p className="text-sm text-gray-500">Updated {v.updated_at?.slice(0, 10)}</p>
                </div>
                <CargoStatusPill status={v.status as VoyageStatus} />
                <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
