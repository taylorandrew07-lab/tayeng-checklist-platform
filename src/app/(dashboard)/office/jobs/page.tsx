'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getJobStatusColor, getJobStatusLabel, formatDate } from '@/lib/utils'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import { useRealtimeRefresh } from '@/lib/realtime'
import type { JobStatus } from '@/lib/types/database'

interface MonitorJob {
  id: string
  title: string
  job_number: string | null
  status: JobStatus
  created_at: string
  scheduled_date: string | null
  submitted_at: string | null
  vessel_name: string | null
  surveyor_name: string | null
  template?: { name: string } | null
  client?: { name: string } | null
}

export default function OfficeJobsMonitor() {
  const [jobs, setJobs] = useState<MonitorJob[]>([])
  const [canView, setCanView] = useState(true)
  const [canOpenDetail, setCanOpenDetail] = useState(false)
  const [loading, setLoading] = useState(true)
  const tick = useRealtimeRefresh('jobs')

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
            id, title, job_number, status, created_at, scheduled_date, submitted_at,
            vessel_name, surveyor_name,
            template:checklist_templates(name),
            client:clients(name)
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
        <p className="text-gray-500 mt-1">{loading ? '…' : `${jobs.length} job${jobs.length !== 1 ? 's' : ''} · read-only`}</p>
      </div>

      {!loading && !canView ? (
        <div className="card p-8 text-center space-y-2">
          <Lock className="h-8 w-8 text-gray-300 mx-auto" />
          <p className="text-sm font-medium text-gray-700">No monitoring access yet</p>
          <p className="text-sm text-gray-500">An administrator needs to grant you job-monitoring permission.</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
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
                ) : jobs.length === 0 ? (
                  <tr><td colSpan={canOpenDetail ? 9 : 8} className="px-4 py-10 text-center text-gray-400">No jobs to display.</td></tr>
                ) : jobs.map(job => (
                  <tr key={job.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{job.title}</p>
                      <p className="text-xs text-gray-400">{job.job_number ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{job.client?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{job.vessel_name ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{job.surveyor_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getJobStatusColor(job.status)}`}>
                        {getJobStatusLabel(job.status)}
                      </span>
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
