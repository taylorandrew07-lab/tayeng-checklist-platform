'use client'

// Admin dashboard — deliberately minimal: just the Recent Jobs list, with the same
// colour-by (client / job type) option as the Jobs page. Everything else you do
// lives in Jobs and Finance.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Briefcase } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import PageHeader from '@/components/ui/PageHeader'
import { useJobsView, rowColor, type JobColorMode } from '@/lib/jobs/view'

// Same three modes as the Jobs page. Colour choice is shared (persisted per-device),
// so picking "Client" here also colours the Jobs grid by client, and vice-versa.
const COLOR_OPTS: { mode: JobColorMode; label: string }[] = [
  { mode: 'none', label: 'None' },
  { mode: 'client', label: 'Client' },
  { mode: 'type', label: 'Job Type' },
]

export default function AdminDashboard() {
  const [recentJobs, setRecentJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const view = useJobsView()

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const supabase = createClient()
    const { data: jobs } = await supabase.from('jobs').select(`
      id, title, job_number, workflow_status, created_at, vessel_name, surveyor_name,
      template:checklist_templates(name, color),
      client:clients(name, color)
    `).order('created_at', { ascending: false }).limit(15)
    setRecentJobs(jobs ?? [])
    setLoading(false)
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader
        title="Dashboard"
        subtitle="Your most recent jobs"
        actions={
          <Link href="/admin/jobs/new" className="btn-primary text-sm">
            <Briefcase className="h-4 w-4" />New Job
          </Link>
        }
      />

      {/* Recent Jobs — the one thing you rely on here, with the Jobs-page colour toggle */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 flex-wrap">
          <h2 className="section-title">Recent Jobs</h2>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs">
              <span className="text-gray-400 mr-1 hidden sm:inline">Colour by</span>
              {COLOR_OPTS.map(o => (
                <button
                  key={o.mode}
                  onClick={() => view.setColorMode(o.mode)}
                  aria-pressed={view.colorMode === o.mode}
                  className={`px-2 py-1 rounded-full border transition-colors ${view.colorMode === o.mode ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <Link href="/admin/jobs" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
          </div>
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
            {recentJobs.map((job) => {
              const c = rowColor(view.colorMode, job.client?.color ?? null, job.template?.color ?? null)
              return (
                <Link
                  key={job.id}
                  href={`/admin/jobs/${job.id}`}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                  style={{ backgroundColor: c ? c.bg : undefined, borderLeft: `3px solid ${c ? c.fg : 'transparent'}` }}
                >
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
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
