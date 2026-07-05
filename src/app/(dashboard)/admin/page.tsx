'use client'

// Admin dashboard — an action hub, not a browsing surface. It surfaces only the
// cross-cutting things you'd otherwise miss: approvals waiting on you, billing/work
// exceptions + expiring documents (AttentionCard), reports submitted and waiting for
// your review, what you're owed, and a short recent-jobs list. Everything you *do*
// lives in Jobs and Finance.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Briefcase, Receipt, FileCheck2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { money } from '@/lib/jobs/tracker'
import { WorkflowPill } from '@/components/job/StatusPill'
import PageHeader from '@/components/ui/PageHeader'
import AttentionCard, { type AttentionItem } from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'
import { useReconciliationAttention } from '@/components/dashboard/useReconciliationAttention'

// Most urgent first when the attention sources are merged.
const TONE_RANK: Record<AttentionItem['tone'], number> = { danger: 0, warn: 1, info: 2 }

// Local yyyy-mm-dd (Trinidad is UTC-4; toISOString() can roll the date near midnight).
function isoDateLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

interface OutstandingRow { currency: string; outstanding: number; overdue: number }

export default function AdminDashboard() {
  const [pending, setPending] = useState({ users: 0, clients: 0, changes: 0 })
  const [recentJobs, setRecentJobs] = useState<any[]>([])
  const [waiting, setWaiting] = useState<any[]>([])
  const [outstanding, setOutstanding] = useState<OutstandingRow[]>([])
  const [loading, setLoading] = useState(true)

  // "Needs your attention" sources, merged into one prioritised queue:
  // billing/work exceptions (jobs done but not invoiced/closed) + expiring or
  // expired surveyor documents (admin-wide; both RLS-gated).
  const docAttention = useDocumentAttention({ context: 'admin' })
  const reconAttention = useReconciliationAttention()
  const attention = [...reconAttention, ...docAttention].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const [
      { count: pendingUserCount },
      { count: pendingClientCount },
      { count: pendingChangeCount },
      { data: jobs },
      { data: waitingJobs },
      { data: invoices },
    ] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
      supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('jobs').select(`
        id, title, job_number, workflow_status, created_at, vessel_name, surveyor_name,
        template:checklist_templates(name),
        client:clients(name)
      `).order('created_at', { ascending: false }).limit(6),
      // Reports submitted by surveyors, sitting in 'report_ready' — awaiting your review/sign-off.
      supabase.from('jobs').select(`
        id, title, report_number, surveyor_name, submitted_at, created_at,
        client:clients(name)
      `).eq('workflow_status', 'report_ready').order('submitted_at', { ascending: true, nullsFirst: false }).limit(8),
      // Money owed: everything sent-but-unpaid (sent/overdue), aggregated per currency.
      supabase.from('invoices').select('status, total, currency, due_date').in('status', ['sent', 'overdue']),
    ])

    setPending({ users: pendingUserCount ?? 0, clients: pendingClientCount ?? 0, changes: pendingChangeCount ?? 0 })
    setRecentJobs(jobs ?? [])
    setWaiting(waitingJobs ?? [])

    const today = isoDateLocal(new Date())
    const byCur = new Map<string, OutstandingRow>()
    for (const inv of invoices ?? []) {
      const currency = String(inv.currency)
      const amt = Number(inv.total ?? 0)
      const isOverdue = inv.status === 'overdue' || (inv.status === 'sent' && !!inv.due_date && inv.due_date < today)
      const e = byCur.get(currency) ?? { currency, outstanding: 0, overdue: 0 }
      e.outstanding += amt
      if (isOverdue) e.overdue += amt
      byCur.set(currency, e)
    }
    setOutstanding(Array.from(byCur.values()).filter(o => o.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding))

    setLoading(false)
  }

  const totalPending = pending.users + pending.clients + pending.changes

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader
        title="Dashboard"
        subtitle="What needs you today"
        actions={
          <Link href="/admin/jobs/new" className="btn-primary text-sm">
            <Briefcase className="h-4 w-4" />New Job
          </Link>
        }
      />

      {/* Pending approvals banner */}
      {totalPending > 0 && (
        <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <span className="font-semibold">{totalPending} pending approval{totalPending > 1 ? 's' : ''}</span>
              {pending.users > 0 && <span className="ml-2 text-yellow-700">{pending.users} team member{pending.users > 1 ? 's' : ''}</span>}
              {pending.clients > 0 && <span className="ml-2 text-yellow-700">{pending.clients} new client{pending.clients > 1 ? 's' : ''}</span>}
              {pending.changes > 0 && <span className="ml-2 text-yellow-700">{pending.changes} profile change{pending.changes > 1 ? 's' : ''}</span>}
            </div>
          </div>
          <Link href={(pending.users + pending.clients) > 0 ? '/admin/users' : '/admin/profile-requests'} className="text-xs font-medium text-yellow-800 hover:text-yellow-900 border border-yellow-300 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors flex-shrink-0">
            Review →
          </Link>
        </div>
      )}

      {/* Money owed — one glance at what's outstanding + overdue, per currency */}
      {!loading && outstanding.length > 0 && (
        <Link href="/admin/invoicing" className="card px-5 py-4 flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2.5 text-gray-500 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center"><Receipt className="h-5 w-5 text-gray-500" /></div>
            <span className="text-sm font-medium">Outstanding</span>
          </div>
          <div className="flex flex-wrap items-baseline justify-end gap-x-6 gap-y-1">
            {outstanding.map(o => (
              <div key={o.currency} className="text-right">
                <span className="tnum font-semibold text-gray-900">{money(o.outstanding, o.currency)}</span>
                {o.overdue > 0 && <span className="ml-2 text-xs text-red-600 tnum">{money(o.overdue, o.currency)} overdue</span>}
              </div>
            ))}
          </div>
        </Link>
      )}

      {/* Needs your attention — billing/work exceptions + expiring documents */}
      <AttentionCard items={attention} />

      {/* Reports waiting on you — surveyor-submitted, sitting in 'report ready' */}
      {waiting.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="section-title flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-indigo-500" />Reports waiting on you
              <span className="text-xs font-normal text-gray-400">{waiting.length}</span>
            </h2>
            <Link href="/admin/jobs" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
          </div>
          <div className="divide-y divide-gray-100">
            {waiting.map((job) => (
              <Link key={job.id} href={`/admin/jobs/${job.id}`} className="flex items-center gap-4 px-6 py-3.5 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{job.title}</p>
                    {job.report_number && <span className="text-xs text-gray-400 flex-shrink-0">{job.report_number}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">{job.client?.name ?? 'No client'} · {job.surveyor_name ?? 'No surveyor'}</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{job.submitted_at ? `submitted ${formatDate(job.submitted_at)}` : formatDate(job.created_at)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Recent Jobs — the daily list you told us you rely on */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="section-title">Recent Jobs</h2>
          <Link href="/admin/jobs" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
        </div>
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-1/3" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : recentJobs.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-gray-400 text-sm">No recent jobs to display.</p>
            <Link href="/admin/jobs/new" className="mt-2 inline-block text-brand-600 hover:text-brand-800 text-sm font-medium">
              Create your first job →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {recentJobs.map((job) => (
              <Link key={job.id} href={`/admin/jobs/${job.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{job.title}</p>
                    <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {job.client?.name ?? 'No client'} · {job.surveyor_name ?? 'No surveyor'} · {job.template?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <WorkflowPill status={job.workflow_status} />
                  <span className="text-xs text-gray-400">{formatDate(job.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
