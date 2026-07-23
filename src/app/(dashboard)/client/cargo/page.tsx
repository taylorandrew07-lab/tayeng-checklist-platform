'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Ship, ChevronRight } from 'lucide-react'
import { CargoStatusPill } from '@/components/job/StatusPill'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
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
      <PageHeader icon={Ship} title="Cargo Monitoring" subtitle="Live monitoring reports shared with you. Read-only; figures update as the surveyor syncs." />

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-20 w-full" />)}</div>
      ) : voyages.length === 0 ? (
        <EmptyState icon={Ship} title="No reports shared yet" description="Cargo monitoring reports will appear here once a surveyor shares one with you." />
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
