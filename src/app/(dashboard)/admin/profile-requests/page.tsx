'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Check, X, ShieldCheck } from 'lucide-react'
import PeopleTabs from '@/components/admin/PeopleTabs'
import EmptyState from '@/components/ui/EmptyState'
import { formatDate } from '@/lib/utils'

interface Req {
  id: string
  user_id: string
  requested_changes: Record<string, any>
  current_values: Record<string, any>
  created_at: string
  user?: { full_name: string; email: string } | null
}

const FIELD_LABELS: Record<string, string> = { full_name: 'Full name', email: 'Email', phone: 'Phone' }

export default function ProfileRequestsPage() {
  const [requests, setRequests] = useState<Req[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [comments, setComments] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const { data } = await supabase
      .from('profile_change_requests')
      .select('id, user_id, requested_changes, current_values, created_at, user:profiles!profile_change_requests_user_id_fkey(full_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    setRequests((data as any) ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function review(id: string, action: 'approve' | 'reject') {
    setBusy(id); setError(null)
    try {
      const res = await fetch(`/api/profile-requests/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment: comments[id] ?? '' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error ?? 'Review failed.')
      await load()
    } catch (err: any) {
      setError(err?.message ?? 'Review failed.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PeopleTabs />
      <div>
        <h1 className="page-title">Approvals</h1>
        <p className="text-gray-500 mt-0.5">Review and approve changes users have requested to their profile.</p>
      </div>

      {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-24 w-full" />)}</div>
      ) : requests.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No pending requests" description="Profile change requests from staff will appear here for review." />
      ) : (
        <div className="space-y-4">
          {requests.map(r => (
            <div key={r.id} className="card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{r.user?.full_name ?? 'Unknown user'}</p>
                  <p className="text-sm text-gray-500">{r.user?.email} · requested {formatDate(r.created_at)}</p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
                {Object.keys(r.requested_changes ?? {}).map(field => (
                  <div key={field} className="px-3 py-2 text-sm flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-600 w-24">{FIELD_LABELS[field] ?? field}</span>
                    <span className="text-gray-400 line-through">{String(r.current_values?.[field] ?? '—')}</span>
                    <span className="text-gray-400">→</span>
                    <span className="text-green-700 font-medium">{String(r.requested_changes[field])}</span>
                  </div>
                ))}
              </div>

              <input
                className="input-base text-sm"
                placeholder="Optional comment (shown to the user)…"
                value={comments[r.id] ?? ''}
                onChange={e => setComments(c => ({ ...c, [r.id]: e.target.value }))}
              />

              <div className="flex justify-end gap-2">
                <button onClick={() => review(r.id, 'reject')} disabled={busy === r.id} className="btn-secondary text-sm text-red-600 border-red-200 hover:bg-red-50">
                  {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}Reject
                </button>
                <button onClick={() => review(r.id, 'approve')} disabled={busy === r.id} className="btn-primary text-sm">
                  {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
