'use client'

// Upcoming jobs panel for the dashboards. Lists future / in-flight jobs in date
// order with their scheduled window, surveyor(s) and status, and flags likely
// double-bookings (same surveyor, overlapping time) with an amber warning.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarClock } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import type { WorkflowStatus } from '@/lib/types/database'
import { useJobsView, rowColor } from '@/lib/jobs/view'
import { listUpcomingJobs, type UpcomingRow } from '@/lib/jobs/upcoming'

const hhmm = (t: string | null) => t?.slice(0, 5) ?? null
function timeLabel(r: UpcomingRow): string {
  const s = hhmm(r.start_time), e = hhmm(r.end_time)
  if (s && e) return `${s}–${e}`
  if (s) return `from ${s}`
  if (e) return `until ${e}`
  return 'All day'
}
// Noon-anchor the date so a 'YYYY-MM-DD' value never renders a day early in UTC-4.
const dateLabel = (d: string) => formatDate(`${d}T12:00:00`)

export default function UpcomingJobs({ hrefBase = '/admin/jobs' }: { hrefBase?: string }) {
  const [rows, setRows] = useState<UpcomingRow[]>([])
  const [loading, setLoading] = useState(true)
  const view = useJobsView()

  useEffect(() => { listUpcomingJobs().then(r => { setRows(r); setLoading(false) }) }, [])

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
        <h2 className="section-title flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-brand-600" />Upcoming Jobs
        </h2>
        <Link href={hrefBase} className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
      </div>

      {loading ? (
        <div className="divide-y divide-gray-100">
          {[0, 1].map(i => (
            <div key={i} className="flex items-center gap-4 px-6 py-4">
              <div className="flex-1 space-y-2"><div className="skeleton h-4 w-1/3" /><div className="skeleton h-3 w-1/2" /></div>
              <div className="skeleton h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <p className="text-gray-400 text-sm">No upcoming jobs scheduled.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {rows.map(r => {
            const c = rowColor(view.colorMode, r.clientColor, r.templateColor)
            return (
              <Link
                key={r.id}
                href={`${hrefBase}/${r.id}`}
                className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors"
                style={{ backgroundColor: c ? c.bg : undefined, borderLeft: `3px solid ${c ? c.fg : 'transparent'}` }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{r.vessel_name ?? r.title}</p>
                    <span className="text-xs text-gray-400 flex-shrink-0">{r.job_number}</span>
                    {r.conflict && (
                      <span
                        title="Possible double-booking — a surveyor overlaps another job"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 flex-shrink-0"
                      >
                        <AlertTriangle className="h-3 w-3" />clash
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {r.surveyorNames.length ? r.surveyorNames.join(', ') : 'No surveyor'} · {r.clientName ?? 'No client'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right hidden sm:block">
                    <p className="text-xs font-medium text-gray-700">{dateLabel(r.scheduled_date)}{r.end_date && r.end_date !== r.scheduled_date ? ` → ${dateLabel(r.end_date)}` : ''}</p>
                    <p className="text-[11px] text-gray-400">{timeLabel(r)}</p>
                  </div>
                  <WorkflowPill status={r.workflow_status as WorkflowStatus} />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
