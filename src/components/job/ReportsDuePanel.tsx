'use client'

// "Reports due" — the jobs whose report-reminder delay has expired and whose
// delivery window has opened, i.e. the reports Andrew can actually sit down and
// write right now. See migration 162 and lib/jobs/reminderWindow.ts.
//
// This panel is deliberately INDEPENDENT of the reminder cron: it derives
// everything live from jobs.reminder_due_at, so it is correct even if the
// scheduler never runs, is misconfigured, or the inbox message was archived. The
// cron only owns the one-off inbox nudge; this is the standing queue.
//
// Super-admin only — this is one person's report queue, not a team board. It
// renders nothing at all for everyone else, and nothing when the queue is empty.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate } from '@/lib/utils'
import { isReminderDue } from '@/lib/jobs/reminderWindow'

interface DueJob {
  id: string
  title: string
  job_number: string | null
  report_number: string | null
  vessel_name: string | null
  job_type: string | null
  reminder_due_at: string | null
  workflow_status: string
}

export default function ReportsDuePanel() {
  const [jobs, setJobs] = useState<DueJob[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => { void load() }, [])

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setReady(true); return }
    const { data: me } = await supabase.from('profiles')
      .select('is_super_admin').eq('id', user.id).maybeSingle()
    if (!me?.is_super_admin) { setReady(true); return }

    const { data } = await supabase.from('jobs')
      .select('id, title, job_number, report_number, vessel_name, job_type, reminder_due_at, workflow_status')
      .not('reminder_due_at', 'is', null)
      .lte('reminder_due_at', new Date().toISOString())
      // 'invoiced' joins the list (mig 188): a billed job's report is plainly done, and
      // a job can reach it from report_ready without ever passing through invoice_ready.
      .not('workflow_status', 'in', '("invoice_ready","invoiced","closed")')
      .order('reminder_due_at', { ascending: true })
      .limit(50)

    // The office-hours rule is applied here, not in the query, so it lives in one
    // place and the stored due_at stays the honest "delay expired" instant.
    setJobs((data ?? []).filter(j => isReminderDue(j.reminder_due_at)) as DueJob[])
    setReady(true)
  }

  if (!ready || jobs.length === 0) return null

  return (
    <div className="card border-l-4 border-l-amber-400">
      {/* No subtitle. It restated the delivery window on every page load — fixed text
          that never changes and says nothing about the jobs actually listed below. */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 flex-wrap">
        <h2 className="section-title flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-500" />
          Reports due
          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{jobs.length}</span>
        </h2>
      </div>
      <div className="divide-y divide-gray-100">
        {jobs.map(j => (
          <Link
            key={j.id}
            href={`/admin/jobs/${j.id}`}
            className="flex items-center gap-4 px-6 py-3 hover:bg-amber-50/60 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-900 truncate">{j.title}</p>
                <span className="text-xs text-gray-400 flex-shrink-0">{j.report_number ?? j.job_number}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {[j.vessel_name, j.job_type].filter(Boolean).join(' · ') || 'No vessel recorded'}
              </p>
            </div>
            <span className="text-xs text-amber-600 font-medium flex-shrink-0">
              since {formatDate(j.reminder_due_at!)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
