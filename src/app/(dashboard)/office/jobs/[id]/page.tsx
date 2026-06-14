'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, formatDateTime } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import type { WorkflowStatus } from '@/lib/types/database'

interface JobDetail {
  id: string
  title: string
  job_number: string | null
  workflow_status: WorkflowStatus
  vessel_name: string | null
  surveyor_name: string | null
  internal_notes: string | null
  scheduled_date: string | null
  created_at: string
  started_at: string | null
  submitted_at: string | null
  completed_at: string | null
  template?: { name: string } | null
  client?: { name: string } | null
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-400 font-medium">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5">{value || '—'}</dd>
    </div>
  )
}

export default function OfficeJobDetail() {
  const params = useParams<{ id: string }>()
  const [job, setJob] = useState<JobDetail | null>(null)
  const [canView, setCanView] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const granted = await fetchMyOfficePermissions(supabase)
      const allowed = granted.has(OFFICE_PERMISSIONS.JOBS_DETAIL_VIEW)
      setCanView(allowed)

      if (allowed) {
        const { data } = await supabase
          .from('jobs')
          .select(`
            id, title, job_number, workflow_status, vessel_name, surveyor_name, internal_notes,
            scheduled_date, created_at, started_at, submitted_at, completed_at,
            template:checklist_templates(name),
            client:clients(name)
          `)
          .eq('id', params.id)
          .maybeSingle()
        setJob((data as unknown as JobDetail) ?? null)
      }
      setLoading(false)
    }
    load()
  }, [params.id])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link href="/office/jobs" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" />Back to monitor
      </Link>

      {loading ? (
        <div className="card p-10 text-center text-gray-400">Loading…</div>
      ) : !canView ? (
        <div className="card p-8 text-center space-y-2">
          <Lock className="h-8 w-8 text-gray-300 mx-auto" />
          <p className="text-sm font-medium text-gray-700">No detail access</p>
          <p className="text-sm text-gray-500">An administrator needs to grant you job-detail permission.</p>
        </div>
      ) : !job ? (
        <div className="card p-10 text-center text-gray-400 text-sm">Job not found.</div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="page-title">{job.title}</h1>
              <p className="text-gray-400 text-sm mt-0.5">{job.job_number ?? 'No job number'}</p>
            </div>
            <WorkflowPill status={job.workflow_status} />
          </div>

          {/* Read-only metadata only — no checklist editor, values, signatures, photos, or PDF. */}
          <div className="card p-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
              <Field label="Client" value={job.client?.name} />
              <Field label="Template" value={job.template?.name} />
              <Field label="Vessel" value={job.vessel_name} />
              <Field label="Surveyor" value={job.surveyor_name} />
              <Field label="Scheduled" value={job.scheduled_date ? formatDate(job.scheduled_date) : null} />
              <Field label="Created" value={formatDateTime(job.created_at)} />
              <Field label="Started" value={job.started_at ? formatDateTime(job.started_at) : null} />
              <Field label="Submitted" value={job.submitted_at ? formatDateTime(job.submitted_at) : null} />
              <Field label="Completed" value={job.completed_at ? formatDateTime(job.completed_at) : null} />
            </dl>
            {job.internal_notes && (
              <div className="mt-6 pt-5 border-t border-gray-100">
                <dt className="text-xs uppercase tracking-wide text-gray-400 font-medium">Internal notes</dt>
                <dd className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{job.internal_notes}</dd>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 text-center">
            Office view is read-only. Checklist responses, signatures, photos and reports are not shown here.
          </p>
        </div>
      )}
    </div>
  )
}
