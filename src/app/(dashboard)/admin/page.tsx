'use client'

// Admin dashboard — deliberately minimal: just the Recent Jobs list. Everything
// else you do lives in Jobs and Finance.
//
// Row colour FOLLOWS the Jobs page and is not settable here. useJobsView() reads the
// same persisted `jobsColorMode`, so whatever you pick in JobsViewToolbar applies here
// too. This page used to carry its own duplicate None/Client/Job Type toggle, which on
// a phone ate a whole row of width to set a preference you'd normally set once.

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Briefcase } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import PageHeader from '@/components/ui/PageHeader'
import ReportsDuePanel from '@/components/job/ReportsDuePanel'
import { useJobsView, rowColor } from '@/lib/jobs/view'

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

      {/* Reports whose incubation/lag window has elapsed and can now be written up.
          Renders nothing unless you're the super-admin and something is actually due. */}
      <ReportsDuePanel />

      {/* Recent Jobs — the one thing you rely on here, with the Jobs-page colour toggle */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 flex-wrap">
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
            {recentJobs.map((job) => {
              const c = rowColor(view.colorMode, job.client?.color ?? null, job.template?.color ?? null)
              return (
                <Link
                  key={job.id}
                  href={`/admin/jobs/${job.id}`}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                  style={{ backgroundColor: c ? c.bg : undefined, borderLeft: `3px solid ${c ? c.fg : 'transparent'}` }}
                >
                  {/* Vessel leads, and the checklist number is gone entirely. The number
                      sat beside the title as flex-shrink-0, so on a phone it held its full
                      width while the name it belonged to truncated to "M...." — the row
                      showed a reference you don't read and hid the one thing you do. Falls
                      back to the title for jobs with no vessel recorded. */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {job.vessel_name || job.title}
                    </p>
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
