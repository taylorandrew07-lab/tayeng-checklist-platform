'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FileText, Briefcase, Users, Building2, X, RefreshCw } from 'lucide-react'
import { getJobStatusColor, getJobStatusLabel, formatDate } from '@/lib/utils'

const CLEARED_AT_KEY = 'recentChecklistsClearedAt'

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    activeTemplates: 0,
    draftTemplates: 0,
    archivedTemplates: 0,
    checklists: 0,
    users: 0,
    clients: 0,
    pendingUsers: 0,
    pendingClients: 0,
    pendingSurveyors: 0,
  })
  const [recentChecklists, setRecentChecklists] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [clearedAt, setClearedAt] = useState<string | null>(null)

  useEffect(() => {
    setClearedAt(localStorage.getItem(CLEARED_AT_KEY))
    loadData()
  }, [])

  async function loadData() {
    const supabase = createClient()
    const [
      { data: templates },
      { count: jobCount },
      { count: userCount },
      { count: clientCount },
      { count: pendingUserCount },
      { count: pendingClientCount },
      { count: pendingSurveyorCount },
      { data: jobs },
    ] = await Promise.all([
      supabase.from('checklist_templates').select('status'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
      supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('surveyor_name_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('jobs').select(`
        id, title, job_number, status, created_at, vessel_name, surveyor_name,
        template:checklist_templates(name),
        client:clients(name)
      `).order('created_at', { ascending: false }).limit(20),
    ])

    const tmpl = templates ?? []
    setStats({
      activeTemplates: tmpl.filter(t => t.status === 'active').length,
      draftTemplates: tmpl.filter(t => t.status === 'draft').length,
      archivedTemplates: tmpl.filter(t => t.status === 'archived').length,
      checklists: jobCount ?? 0,
      users: userCount ?? 0,
      clients: clientCount ?? 0,
      pendingUsers: pendingUserCount ?? 0,
      pendingClients: pendingClientCount ?? 0,
      pendingSurveyors: pendingSurveyorCount ?? 0,
    })
    setRecentChecklists(jobs ?? [])
    setLoading(false)
  }

  function handleClear() {
    const now = new Date().toISOString()
    localStorage.setItem(CLEARED_AT_KEY, now)
    setClearedAt(now)
  }

  function handleUnclear() {
    localStorage.removeItem(CLEARED_AT_KEY)
    setClearedAt(null)
  }

  const visibleChecklists = clearedAt
    ? recentChecklists.filter(j => j.created_at > clearedAt).slice(0, 6)
    : recentChecklists.slice(0, 6)

  const totalPending = stats.pendingUsers + stats.pendingClients + stats.pendingSurveyors

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="page-title">Admin Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of all activity</p>
      </div>

      {/* Pending approvals banner */}
      {totalPending > 0 && (
        <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <span className="font-semibold">{totalPending} pending approval{totalPending > 1 ? 's' : ''}</span>
              {stats.pendingUsers > 0 && <span className="ml-2 text-yellow-700">{stats.pendingUsers} user{stats.pendingUsers > 1 ? 's' : ''}</span>}
              {stats.pendingClients > 0 && <span className="ml-2 text-yellow-700">{stats.pendingClients} new client{stats.pendingClients > 1 ? 's' : ''}</span>}
              {stats.pendingSurveyors > 0 && <span className="ml-2 text-yellow-700">{stats.pendingSurveyors} new surveyor name{stats.pendingSurveyors > 1 ? 's' : ''}</span>}
            </div>
          </div>
          <Link href="/admin/users" className="text-xs font-medium text-yellow-800 hover:text-yellow-900 border border-yellow-300 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors flex-shrink-0">
            Review →
          </Link>
        </div>
      )}

      {/* Main stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Link href="/admin/templates" className="card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Templates</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{loading ? '—' : stats.activeTemplates}</p>
              <p className="text-xs text-gray-400 mt-0.5">active</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-500 flex items-center justify-center">
              <FileText className="h-6 w-6 text-white" />
            </div>
          </div>
        </Link>

        <Link href="/admin/jobs" className="card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Jobs</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{loading ? '—' : stats.checklists}</p>
              <p className="text-xs text-gray-400 mt-0.5">total</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-indigo-500 flex items-center justify-center">
              <Briefcase className="h-6 w-6 text-white" />
            </div>
          </div>
        </Link>

        <Link href="/admin/users" className="card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Users</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{loading ? '—' : stats.users}</p>
              {stats.pendingUsers > 0 && <p className="text-xs text-yellow-600 mt-0.5 font-medium">{stats.pendingUsers} pending</p>}
            </div>
            <div className="w-12 h-12 rounded-xl bg-purple-500 flex items-center justify-center">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </Link>

        <Link href="/admin/clients" className="card p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Clients</p>
              <p className="text-3xl font-bold text-gray-900 mt-1">{loading ? '—' : stats.clients}</p>
              {stats.pendingClients > 0 && <p className="text-xs text-yellow-600 mt-0.5 font-medium">{stats.pendingClients} pending</p>}
            </div>
            <div className="w-12 h-12 rounded-xl bg-pink-500 flex items-center justify-center">
              <Building2 className="h-6 w-6 text-white" />
            </div>
          </div>
        </Link>
      </div>

      {/* Template breakdown */}
      {!loading && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card p-4 flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-green-500 flex-shrink-0" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.activeTemplates}</p>
              <p className="text-sm text-gray-500">Active templates</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-gray-400 flex-shrink-0" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.draftTemplates}</p>
              <p className="text-sm text-gray-500">Draft templates</p>
            </div>
          </div>
          <div className="card p-4 flex items-center gap-4">
            <div className="w-3 h-3 rounded-full bg-red-400 flex-shrink-0" />
            <div>
              <p className="text-2xl font-bold text-gray-900">{stats.archivedTemplates}</p>
              <p className="text-sm text-gray-500">Archived templates</p>
            </div>
          </div>
        </div>
      )}

      {/* Recent Checklists */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="section-title">Recent Jobs</h2>
          <div className="flex items-center gap-2">
            {clearedAt && (
              <button
                onClick={handleUnclear}
                className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-800 font-medium"
                title="Show all recent checklists"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Restore
              </button>
            )}
            {visibleChecklists.length > 0 && (
              <button
                onClick={handleClear}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium"
                title="Clear recent checklists from dashboard (does not delete records)"
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </button>
            )}
            <Link href="/admin/jobs" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
          </div>
        </div>
        {loading ? (
          <div className="px-6 py-10 text-center text-gray-400">Loading…</div>
        ) : visibleChecklists.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-gray-400 text-sm">No recent checklists to display.</p>
            <Link href="/admin/jobs/new" className="mt-2 inline-block text-brand-600 hover:text-brand-800 text-sm font-medium">
              Create your first checklist →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {visibleChecklists.map((job) => (
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
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getJobStatusColor(job.status)}`}>
                    {getJobStatusLabel(job.status)}
                  </span>
                  <span className="text-xs text-gray-400">{formatDate(job.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'New Template', href: '/admin/templates/new', icon: FileText },
          { label: 'New Job', href: '/admin/jobs/new', icon: Briefcase },
          { label: 'Add User', href: '/admin/users', icon: Users },
          { label: 'Add Client', href: '/admin/clients', icon: Building2 },
        ].map((action) => (
          <Link key={action.label} href={action.href} className="btn-secondary justify-center py-3 flex-col gap-1 h-auto">
            <action.icon className="h-5 w-5" />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
