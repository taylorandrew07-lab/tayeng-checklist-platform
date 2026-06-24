'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Briefcase, Clock, CheckCircle2, FileCheck2, Lock } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import PageHeader from '@/components/ui/PageHeader'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import AttentionCard from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'
import type { WorkflowStatus } from '@/lib/types/database'

interface MonitorJob {
  id: string
  title: string
  job_number: string | null
  workflow_status: WorkflowStatus
  created_at: string
  vessel_name: string | null
  surveyor_name: string | null
  template?: { name: string } | null
  client?: { name: string } | null
}

// Workflow stages that represent active/ongoing work for the office summary.
const ONGOING: WorkflowStatus[] = ['new', 'assigned', 'in_progress', 'report_ready']

export default function OfficeDashboard() {
  const [jobs, setJobs] = useState<MonitorJob[]>([])
  const [canView, setCanView] = useState(true)
  const [docsView, setDocsView] = useState(false)
  const [loading, setLoading] = useState(true)
  // Expiring surveyor documents — only when this office user can view them.
  const docAttention = useDocumentAttention({ context: 'office', enabled: docsView })

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const granted = await fetchMyOfficePermissions(supabase)
      const allowed =
        granted.has(OFFICE_PERMISSIONS.JOBS_MONITOR_VIEW) ||
        granted.has(OFFICE_PERMISSIONS.JOBS_DETAIL_VIEW)
      setCanView(allowed)
      setDocsView(granted.has(OFFICE_PERMISSIONS.PERSONAL_DOCS_VIEW))

      if (allowed) {
        const { data } = await supabase
          .from('jobs')
          .select(`
            id, title, job_number, workflow_status, created_at, vessel_name, surveyor_name,
            template:checklist_templates(name),
            client:clients(name)
          `)
          .order('created_at', { ascending: false })
        setJobs((data as unknown as MonitorJob[]) ?? [])
      }
      setLoading(false)
    }
    load()
  }, [])

  const counts = jobs.reduce<Record<string, number>>((acc, j) => {
    acc[j.workflow_status] = (acc[j.workflow_status] ?? 0) + 1
    return acc
  }, {})
  const ongoingCount = ONGOING.reduce((n, s) => n + (counts[s] ?? 0), 0)
  const recent = jobs.slice(0, 8)

  const summaryCards = [
    { label: 'Ongoing jobs', value: ongoingCount, icon: Briefcase, color: 'bg-indigo-500' },
    { label: 'In progress', value: counts['in_progress'] ?? 0, icon: Clock, color: 'bg-amber-500' },
    { label: 'Report ready', value: counts['report_ready'] ?? 0, icon: FileCheck2, color: 'bg-blue-500' },
    { label: 'Approved', value: counts['approved'] ?? 0, icon: CheckCircle2, color: 'bg-green-500' },
  ]

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PageHeader title="Dashboard" subtitle="Read-only overview of job activity" />

      <AttentionCard items={docAttention} />

      {!loading && !canView ? (
        <div className="card p-8 text-center space-y-2">
          <Lock className="h-8 w-8 text-gray-300 mx-auto" />
          <p className="text-sm font-medium text-gray-700">No monitoring access yet</p>
          <p className="text-sm text-gray-500">An administrator needs to grant you job-monitoring permission.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {summaryCards.map(c => (
              <div key={c.label} className="card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{c.label}</p>
                    {loading
                      ? <div className="skeleton h-8 w-14 mt-1.5" />
                      : <p className="text-3xl font-bold text-gray-900 mt-1 tnum">{c.value}</p>}
                  </div>
                  <div className={`w-12 h-12 rounded-xl ${c.color} flex items-center justify-center`}>
                    <c.icon className="h-6 w-6 text-white" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="section-title">Recent Jobs</h2>
              <Link href="/office/jobs" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
            </div>
            {loading ? (
              <div className="px-6 py-10 text-center text-gray-400">Loading…</div>
            ) : recent.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-400 text-sm">No jobs to display.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {recent.map(job => (
                  <Link key={job.id} href={`/office/jobs/${job.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 truncate">{job.title}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {job.client?.name ?? 'No client'} · {job.surveyor_name ?? 'No surveyor'} · {job.template?.name ?? '—'}
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
        </>
      )}
    </div>
  )
}
