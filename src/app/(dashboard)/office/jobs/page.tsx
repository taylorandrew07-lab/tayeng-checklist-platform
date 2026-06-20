'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Lock, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import { useRealtimeRefresh } from '@/lib/realtime'
import { useJobsView, availableYears, inYearMonth, rowColor, buildLegend } from '@/lib/jobs/view'
import JobsViewToolbar from '@/components/job/JobsViewToolbar'
import type { WorkflowStatus } from '@/lib/types/database'

interface MonitorJob {
  id: string
  title: string
  job_number: string | null
  workflow_status: WorkflowStatus
  created_at: string
  scheduled_date: string | null
  submitted_at: string | null
  vessel_name: string | null
  surveyor_name: string | null
  template?: { name: string; color: string | null } | null
  client?: { name: string; color: string | null } | null
}

export default function OfficeJobsMonitor() {
  const router = useRouter()
  const [jobs, setJobs] = useState<MonitorJob[]>([])
  const [canView, setCanView] = useState(true)
  const [canOpenDetail, setCanOpenDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  const tick = useRealtimeRefresh('jobs')
  const view = useJobsView()
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const statusOptions = useMemo(() => Array.from(new Set(jobs.map(j => j.workflow_status))).sort(), [jobs])
  const filteredJobs = useMemo(() => {
    const term = q.trim().toLowerCase()
    return jobs.filter(j => {
      if (!inYearMonth(j.created_at, view.year, view.month)) return false
      if (statusFilter && j.workflow_status !== statusFilter) return false
      if (!term) return true
      return [j.title, j.job_number, j.client?.name, j.vessel_name, j.surveyor_name]
        .some(v => (v ?? '').toLowerCase().includes(term))
    })
  }, [jobs, view.year, view.month, q, statusFilter])
  const jobYears = useMemo(() => availableYears(jobs, j => j.created_at), [jobs])
  const legend = useMemo(() => buildLegend(view.colorMode, filteredJobs.map(j => ({
    clientName: j.client?.name ?? null, clientColor: j.client?.color ?? null,
    typeName: j.template?.name ?? null, typeColor: j.template?.color ?? null,
  }))), [view.colorMode, filteredJobs])

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const granted = await fetchMyOfficePermissions(supabase)
      const allowed =
        granted.has(OFFICE_PERMISSIONS.JOBS_MONITOR_VIEW) ||
        granted.has(OFFICE_PERMISSIONS.JOBS_DETAIL_VIEW)
      setCanView(allowed)
      setCanOpenDetail(granted.has(OFFICE_PERMISSIONS.JOBS_DETAIL_VIEW))

      if (allowed) {
        const { data } = await supabase
          .from('jobs')
          .select(`
            id, title, job_number, workflow_status, created_at, scheduled_date, submitted_at,
            vessel_name, surveyor_name,
            template:checklist_templates(name, color),
            client:clients(name, color)
          `)
          .order('created_at', { ascending: false })
        setJobs((data as unknown as MonitorJob[]) ?? [])
      }
      setLoading(false)
    }
    load()
  }, [tick])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="page-title">Jobs Monitor</h1>
        <p className="text-gray-500 mt-1">{loading ? '…' : `${filteredJobs.length} job${filteredJobs.length !== 1 ? 's' : ''} · read-only`}</p>
      </div>

      {!loading && !canView ? (
        <div className="card p-8 text-center space-y-2">
          <Lock className="h-8 w-8 text-gray-300 mx-auto" />
          <p className="text-sm font-medium text-gray-700">No monitoring access yet</p>
          <p className="text-sm text-gray-500">An administrator needs to grant you job-monitoring permission.</p>
        </div>
      ) : (
        <>
        {!loading && <JobsViewToolbar view={view} years={jobYears} count={filteredJobs.length} legend={legend} />}
        {!loading && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search job, client, vessel or surveyor…" className="input-base pl-9" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input-base sm:w-48 capitalize">
              <option value="">All statuses</option>
              {statusOptions.map(s => <option key={s} value={s} className="capitalize">{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        )}
        <div className="card overflow-hidden hidden sm:block landscape:block">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Job</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Vessel</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Surveyor</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Scheduled</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Submitted</th>
                  {canOpenDetail && <th className="text-left px-4 py-3 font-medium text-gray-700"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  <tr><td colSpan={canOpenDetail ? 9 : 8} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
                ) : filteredJobs.length === 0 ? (
                  <tr><td colSpan={canOpenDetail ? 9 : 8} className="px-4 py-10 text-center text-gray-400">No jobs to display.</td></tr>
                ) : filteredJobs.map(job => {
                  const c = rowColor(view.colorMode, job.client?.color ?? null, job.template?.color ?? null)
                  return (
                  <tr
                    key={job.id}
                    onClick={canOpenDetail ? () => router.push(`/office/jobs/${job.id}`) : undefined}
                    className={`hover:bg-gray-50 ${canOpenDetail ? 'cursor-pointer' : ''}`}
                    style={c ? { backgroundColor: c.bg } : undefined}
                  >
                    <td className="px-4 py-3" style={{ borderLeft: `4px solid ${c ? c.fg : 'transparent'}` }}>
                      <p className="font-medium text-gray-900">{job.title}</p>
                      <p className="text-xs text-gray-400">{job.job_number ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{job.client?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{job.vessel_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{job.surveyor_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <WorkflowPill status={job.workflow_status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">{job.scheduled_date ? formatDate(job.scheduled_date) : '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(job.created_at)}</td>
                    <td className="px-4 py-3 text-gray-500">{job.submitted_at ? formatDate(job.submitted_at) : '—'}</td>
                    {canOpenDetail && (
                      <td className="px-4 py-3">
                        <Link href={`/office/jobs/${job.id}`} className="text-xs text-brand-600 hover:text-brand-800 font-medium">View →</Link>
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Stacked cards — portrait / narrow phones. */}
        <div className="space-y-3 sm:hidden landscape:hidden">
          {loading ? (
            <div className="card p-8 text-center text-gray-400">Loading…</div>
          ) : filteredJobs.length === 0 ? (
            <div className="card p-8 text-center text-gray-400">No jobs to display.</div>
          ) : filteredJobs.map(job => {
            const c = rowColor(view.colorMode, job.client?.color ?? null, job.template?.color ?? null)
            return (
            <div
              key={job.id}
              onClick={canOpenDetail ? () => router.push(`/office/jobs/${job.id}`) : undefined}
              className={`card p-4 space-y-2 ${canOpenDetail ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
              style={c ? { backgroundColor: c.bg, borderLeft: `4px solid ${c.fg}` } : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-gray-900">{job.title}</p>
                <WorkflowPill status={job.workflow_status} className="flex-shrink-0" />
              </div>
              <p className="text-xs text-gray-400">{job.job_number ?? '—'}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm pt-1">
                <div><p className="text-[11px] text-gray-400">Client</p><p className="text-gray-700">{job.client?.name ?? '—'}</p></div>
                <div><p className="text-[11px] text-gray-400">Vessel</p><p className="text-gray-700">{job.vessel_name ?? '—'}</p></div>
                <div><p className="text-[11px] text-gray-400">Surveyor</p><p className="text-gray-700">{job.surveyor_name ?? '—'}</p></div>
                <div><p className="text-[11px] text-gray-400">Scheduled</p><p className="text-gray-700">{job.scheduled_date ? formatDate(job.scheduled_date) : '—'}</p></div>
                <div><p className="text-[11px] text-gray-400">Submitted</p><p className="text-gray-700">{job.submitted_at ? formatDate(job.submitted_at) : '—'}</p></div>
              </div>
            </div>
            )
          })}
        </div>
        </>
      )}
    </div>
  )
}
