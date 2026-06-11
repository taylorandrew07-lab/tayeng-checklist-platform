'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { listExpiring, type ExpiringDoc } from '@/lib/personal-docs/api'

/**
 * Dashboard card of expired / soon-to-expire documents. Pass `profileId` for a
 * surveyor's own; omit it for the team-wide view (admin/office). Renders nothing
 * when there's nothing to flag. RLS governs what the team-wide query returns.
 */
export default function ExpiringDocsWidget({ profileId }: { profileId?: string }) {
  const [docs, setDocs] = useState<ExpiringDoc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    listExpiring(profileId).then(d => { if (active) { setDocs(d); setLoading(false) } }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [profileId])

  if (loading || docs.length === 0) return null

  return (
    <div className="card p-4 border border-amber-200 bg-amber-50/40">
      <h2 className="section-title flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        Documents needing attention
        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{docs.length}</span>
      </h2>
      <div className="space-y-2">
        {docs.map(d => (
          <div key={d.id} className="flex items-center gap-3 text-sm">
            <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${d.status === 'expired' ? 'bg-red-500' : 'bg-amber-500'}`} />
            <div className="min-w-0 flex-1">
              <span className="font-medium text-gray-900">{d.doc_name}</span>
              {!profileId && <span className="text-gray-500"> — {d.owner_name}</span>}
            </div>
            <span className={`text-xs font-medium ${d.status === 'expired' ? 'text-red-700' : 'text-amber-700'}`}>
              {d.status === 'expired' ? `expired ${Math.abs(d.days ?? 0)}d ago` : `in ${d.days}d`} · {d.expiry_date}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
