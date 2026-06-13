'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import JobChecklistEditor, { type JobChecklistEditorHandle } from '@/components/job/JobChecklistEditor'
import JobOpsPanel from '@/components/job/JobOpsPanel'
import { WORKFLOW } from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

export default function SurveyorJobPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.id as string
  const editorRef = useRef<JobChecklistEditorHandle>(null)
  const [job, setJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await createClient()
      .from('jobs')
      .select('id, title, report_number, job_type, vessel_name, workflow_status, template_id, status, assigned_to, surveyor_name, client_id, created_by, created_at, updated_at')
      .eq('id', jobId).single()
    setJob(data ?? null)
    setLoading(false)
  }
  useEffect(() => { load() }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  function back() {
    if (job?.template_id) editorRef.current?.navigate('/surveyor')
    else router.push('/surveyor')
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!job) return <div className="max-w-3xl mx-auto py-16 text-center text-gray-400">Job not found.</div>

  const w = WORKFLOW[job.workflow_status as WorkflowStatus]

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-rise">
      <div className="flex items-center gap-4">
        <button onClick={back} className="btn-ghost py-2 px-3" aria-label="Back to dashboard"><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="page-title truncate">{job.vessel_name ?? job.title}</h1>
            {w && <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${w.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${w.dot}`} />{w.label}</span>}
          </div>
          <p className="text-gray-500 mt-0.5 text-sm">
            {job.report_number && <span className="font-medium text-gray-700 tnum">{job.report_number}</span>}
            {job.job_type ? `${job.report_number ? ' · ' : ''}${job.job_type}` : ''}
          </p>
        </div>
      </div>

      {/* Surveyor ops: read-only status + their own assignment + report/VOS upload. */}
      <JobOpsPanel job={job} isAdmin={false} onChanged={load} />

      {/* Checklist editor only for checklist jobs (report-only jobs have no template). */}
      {job.template_id && (
        <div className="border-t border-gray-200 pt-6">
          <JobChecklistEditor ref={editorRef} jobId={jobId} backHref="/surveyor" />
        </div>
      )}
    </div>
  )
}
