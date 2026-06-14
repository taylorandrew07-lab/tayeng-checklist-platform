'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { CloudOff } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import { useRealtimeRefresh } from '@/lib/realtime'
import { getLocalCreateDrafts, offlineAvailable } from '@/lib/offline/db'
import { loadNewJobData } from '@/lib/offline/newJobData'
import AttentionCard from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'

export default function SurveyorDashboard() {
  const [profile, setProfile] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  const [localJobs, setLocalJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const tick = useRealtimeRefresh('jobs')
  // Your own documents expired or expiring soon.
  const docAttention = useDocumentAttention({ context: 'self', profileId: profile?.id, enabled: !!profile?.id })

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const [{ data: p }, { data: j }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', session.user.id).single(),
        supabase.from('jobs')
          .select(`
            id, title, job_number, status, workflow_status, created_at, vessel_name, surveyor_name,
            template:checklist_templates(name),
            client:clients(name)
          `)
          .or(`created_by.eq.${session.user.id},assigned_to.eq.${session.user.id}`)
          .order('created_at', { ascending: false }),
      ])

      setProfile(p)
      setJobs(j ?? [])

      // Jobs started offline live only on this device until they sync — surface
      // them so the surveyor can reopen them (server list won't include them yet).
      if (offlineAvailable()) {
        const serverIds = new Set((j ?? []).map((x: any) => x.id))
        const drafts = await getLocalCreateDrafts(session.user.id).catch(() => [])
        setLocalJobs(drafts.filter(d => !serverIds.has(d.jobId)).map(d => d.job))
      }
      setLoading(false)
    }
    load()
  }, [tick])

  // Keep the startable templates + clients + surveyors cached so a new job can be
  // started later with no signal. Refreshes once per dashboard open (when online).
  useEffect(() => { void loadNewJobData().catch(() => {}) }, [])

  // Bucket by the unified workflow status (kept in sync with the checklist phase).
  const active = jobs.filter(j => ['new', 'assigned', 'in_progress'].includes(j.workflow_status))
  const submitted = jobs.filter(j => !['new', 'assigned', 'in_progress'].includes(j.workflow_status))

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-rise">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">My Jobs</h1>
          <p className="text-gray-500 mt-1">Welcome, {profile?.full_name ?? '…'}</p>
        </div>
        <Link href="/surveyor/jobs/new" className="btn-primary">
          <Plus className="h-4 w-4" />New Job
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 text-center">
              <p className="text-3xl font-bold text-yellow-600 tnum">{active.length}</p>
              <p className="text-sm text-gray-500 mt-1">Active</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-3xl font-bold text-purple-600 tnum">{submitted.length}</p>
              <p className="text-sm text-gray-500 mt-1">Submitted</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-3xl font-bold text-gray-600 tnum">{jobs.length}</p>
              <p className="text-sm text-gray-500 mt-1">Total</p>
            </div>
          </div>

          <AttentionCard items={docAttention} />

          {localJobs.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Saved on this device — not yet synced</h2>
              <div className="space-y-3">
                {localJobs.map(job => (
                  <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow border-amber-200">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{job.title}</p>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">{job.template?.name} · {job.client?.name ?? 'No client'}</p>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 bg-amber-100 text-amber-700">
                      <CloudOff className="h-3 w-3" />Will sync
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {active.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Active Jobs</h2>
              <div className="space-y-3">
                {active.map(job => (
                  <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{job.title}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {job.template?.name} · {job.client?.name ?? 'No client'} · {formatDate(job.created_at)}
                      </p>
                    </div>
                    <WorkflowPill status={job.workflow_status} className="flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {submitted.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Submitted / Completed</h2>
              <div className="space-y-3">
                {submitted.map(job => (
                  <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{job.title}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {job.template?.name} · {job.client?.name ?? 'No client'} · {formatDate(job.created_at)}
                      </p>
                    </div>
                    <WorkflowPill status={job.workflow_status} className="flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {jobs.length === 0 && (
            <div className="card p-10 text-center text-gray-400">
              <p className="mb-3">You haven&apos;t created any jobs yet.</p>
              <Link href="/surveyor/jobs/new" className="btn-primary inline-flex">
                <Plus className="h-4 w-4" />Start your first job
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}
