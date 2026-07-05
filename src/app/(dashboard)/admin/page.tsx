'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FileText, Briefcase, Users, Building2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import PageHeader from '@/components/ui/PageHeader'
import AttentionCard, { type AttentionItem } from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'
import { useReconciliationAttention } from '@/components/dashboard/useReconciliationAttention'

// Most urgent first when the attention sources are merged.
const TONE_RANK: Record<AttentionItem['tone'], number> = { danger: 0, warn: 1, info: 2 }

// ── Dashboard tiles ───────────────────────────────────────────────────────
// A fixed catalog-count row (templates, jobs, users, clients).
type TileKey = 'activeTemplates' | 'totalJobs' | 'users' | 'clients'

interface TileDef { label: string; sub?: string; href: string; icon: typeof FileText }

const TILE_DEFS: Record<TileKey, TileDef> = {
  activeTemplates: { label: 'Templates', sub: 'active', href: '/admin/templates', icon: FileText },
  totalJobs:       { label: 'Jobs',      sub: 'total',  href: '/admin/jobs',      icon: Briefcase },
  users:           { label: 'Users',     href: '/admin/users',   icon: Users },
  clients:         { label: 'Clients',   href: '/admin/clients', icon: Building2 },
}
const TILE_KEYS: TileKey[] = ['activeTemplates', 'totalJobs', 'users', 'clients']

/** A single metric tile — one quiet tile language (colour is reserved for state). */
function StatTile({ def, value, loading }: { def: TileDef; value: number; loading: boolean }) {
  return (
    <Link href={def.href} className="card p-5 transition-[transform,box-shadow] duration-200 hover:shadow-md hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{def.label}</p>
          {loading
            ? <div className="skeleton h-8 w-14 mt-1.5" />
            : <p className="text-3xl font-bold text-gray-900 mt-1 tnum">{value}</p>}
          {def.sub && <p className="text-xs text-gray-400 mt-0.5">{def.sub}</p>}
        </div>
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
          <def.icon className="h-6 w-6 text-gray-500" />
        </div>
      </div>
    </Link>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    activeTemplates: 0, checklists: 0,
    users: 0, clients: 0,
    pendingUsers: 0, pendingClients: 0, pendingChanges: 0,
  })
  const [recentJobs, setRecentJobs] = useState<any[]>([])
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
      { data: templates },
      { count: jobCount },
      { count: userCount },
      { count: clientCount },
      { count: pendingUserCount },
      { count: pendingClientCount },
      { count: pendingChangeCount },
      { data: jobs },
    ] = await Promise.all([
      supabase.from('checklist_templates').select('status'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
      supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('jobs').select(`
        id, title, job_number, workflow_status, created_at, vessel_name, surveyor_name,
        template:checklist_templates(name),
        client:clients(name)
      `).order('created_at', { ascending: false }).limit(6),
    ])

    const tmpl = templates ?? []
    setStats({
      activeTemplates: tmpl.filter(t => t.status === 'active').length,
      checklists: jobCount ?? 0,
      users: userCount ?? 0,
      clients: clientCount ?? 0,
      pendingUsers: pendingUserCount ?? 0,
      pendingClients: pendingClientCount ?? 0,
      pendingChanges: pendingChangeCount ?? 0,
    })
    setRecentJobs(jobs ?? [])
    setLoading(false)
  }

  const totalPending = stats.pendingUsers + stats.pendingClients + stats.pendingChanges

  const tileValue = (k: TileKey): number => {
    switch (k) {
      case 'activeTemplates': return stats.activeTemplates
      case 'totalJobs': return stats.checklists
      case 'users': return stats.users
      case 'clients': return stats.clients
    }
  }

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
              {stats.pendingUsers > 0 && <span className="ml-2 text-yellow-700">{stats.pendingUsers} user{stats.pendingUsers > 1 ? 's' : ''}</span>}
              {stats.pendingClients > 0 && <span className="ml-2 text-yellow-700">{stats.pendingClients} new client{stats.pendingClients > 1 ? 's' : ''}</span>}
              {stats.pendingChanges > 0 && <span className="ml-2 text-yellow-700">{stats.pendingChanges} profile change{stats.pendingChanges > 1 ? 's' : ''}</span>}
            </div>
          </div>
          <Link href={(stats.pendingUsers + stats.pendingClients) > 0 ? '/admin/users' : '/admin/profile-requests'} className="text-xs font-medium text-yellow-800 hover:text-yellow-900 border border-yellow-300 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors flex-shrink-0">
            Review →
          </Link>
        </div>
      )}

      {/* Needs your attention — billing/work exceptions + expiring documents */}
      <AttentionCard items={attention} />

      {/* Recent Jobs — the most useful daily list, directly under the attention card */}
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

      {/* Catalog counts */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {TILE_KEYS.map(k => <StatTile key={k} def={TILE_DEFS[k]} value={tileValue(k)} loading={loading} />)}
      </div>
    </div>
  )
}
