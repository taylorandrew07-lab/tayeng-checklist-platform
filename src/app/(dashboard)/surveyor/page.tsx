'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Loader2, CloudOff, AlertTriangle, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, withTimeout } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import { useRealtimeRefresh } from '@/lib/realtime'
import { getLocalCreateDrafts, offlineAvailable } from '@/lib/offline/db'
import { loadNewJobData } from '@/lib/offline/newJobData'
import AttentionCard from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'

export default function SurveyorDashboard() {
  const [profile, setProfile] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  // jobId → this surveyor's own regular/OT hours + km on that job (for pay tracking).
  const [mine, setMine] = useState<Record<string, { reg: number; ot: number; km: number }>>({})
  const [localJobs, setLocalJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const tick = useRealtimeRefresh('jobs')
  // Your own documents expired or expiring soon.
  const docAttention = useDocumentAttention({ context: 'self', profileId: profile?.id, enabled: !!profile?.id })

  useEffect(() => {
    let active = true
    async function load() {
      setError(null)
      try {
        const supabase = createClient()
        // Time-bound every call so a stalled request on weak field wifi surfaces an
        // error + Retry instead of leaving the dashboard on an endless spinner.
        const { data: { session } } = await withTimeout(supabase.auth.getSession(), 12_000, 'Loading')
        if (!session) { if (active) setLoading(false); return }

        // Fetch the profile and the IDs of every job this surveyor is linked to via
        // the job_surveyors join table (multi-surveyor jobs). A secondary surveyor is
        // NOT in jobs.assigned_to, so without this they'd never see jobs they share.
        const [pRes, sRes] = await withTimeout(Promise.all([
          supabase.from('profiles').select('*').eq('id', session.user.id).single(),
          supabase.from('job_surveyors').select('id, job_id, regular_hours, overtime_hours').eq('surveyor_id', session.user.id),
        ]), 12_000, 'Loading')

        const myRows = (sRes.data ?? []) as any[]
        const linkedIds = Array.from(new Set(myRows.map((r: any) => r.job_id)))

        // This surveyor's km per job (their own rows only — RLS already scopes it).
        const myJsIds = myRows.map(r => r.id)
        const kmByJs: Record<string, number> = {}
        if (myJsIds.length) {
          const { data: kmRows } = await withTimeout(
            supabase.from('job_surveyor_km').select('job_surveyor_id, km').in('job_surveyor_id', myJsIds),
            12_000, 'Loading').catch(() => ({ data: [] as any[] }))
          for (const k of (kmRows ?? []) as any[]) kmByJs[k.job_surveyor_id] = (kmByJs[k.job_surveyor_id] ?? 0) + Number(k.km ?? 0)
        }
        const mineMap: Record<string, { reg: number; ot: number; km: number }> = {}
        for (const r of myRows) {
          mineMap[r.job_id] = { reg: Number(r.regular_hours ?? 0), ot: Number(r.overtime_hours ?? 0), km: kmByJs[r.id] ?? 0 }
        }
        const orParts = [
          `created_by.eq.${session.user.id}`,
          `assigned_to.eq.${session.user.id}`,
          ...(linkedIds.length ? [`id.in.(${linkedIds.join(',')})`] : []),
        ]

        const jRes = await withTimeout(
          supabase.from('jobs')
            .select(`
              id, title, job_number, workflow_status, created_at, vessel_name, surveyor_name,
              template:checklist_templates(name),
              client:clients(name)
            `)
            .or(orParts.join(','))
            .order('created_at', { ascending: false }),
          15_000, 'Loading your jobs')
        if (jRes.error) throw jRes.error
        if (!active) return

        setProfile(pRes.data)
        setJobs(jRes.data ?? [])
        setMine(mineMap)

        // Jobs started offline live only on this device until they sync — surface
        // them so the surveyor can reopen them (server list won't include them yet).
        if (offlineAvailable()) {
          const serverIds = new Set((jRes.data ?? []).map((x: any) => x.id))
          const drafts = await getLocalCreateDrafts(session.user.id).catch(() => [])
          if (active) setLocalJobs(drafts.filter(d => !serverIds.has(d.jobId)).map(d => d.job))
        }
      } catch (e: any) {
        if (active) setError(e?.message ?? 'Could not load your jobs — check your connection and try again.')
      } finally {
        if (active) setLoading(false)
      }
    }
    setLoading(true)
    load()
    return () => { active = false }
  }, [tick, reloadKey])

  // Keep the startable templates + clients + surveyors cached so a new job can be
  // started later with no signal. Refreshes once per dashboard open (when online).
  useEffect(() => { void loadNewJobData().catch(() => {}) }, [])

  // Bucket by the unified workflow status (kept in sync with the checklist phase).
  const active = jobs.filter(j => ['new', 'assigned', 'in_progress'].includes(j.workflow_status))
  const submitted = jobs.filter(j => !['new', 'assigned', 'in_progress'].includes(j.workflow_status))

  // Totals across all jobs, so the surveyor can sanity-check their pay at a glance.
  const totals = Object.values(mine).reduce((a, m) => ({ reg: a.reg + m.reg, ot: a.ot + m.ot, km: a.km + m.km }), { reg: 0, ot: 0, km: 0 })

  // The surveyor's own hours + km on a job, shown under the card title for pay tracking.
  function MyLine({ jobId }: { jobId: string }) {
    const m = mine[jobId]
    if (!m || (!m.reg && !m.ot && !m.km)) return null
    const parts: string[] = []
    if (m.reg) parts.push(`${m.reg}h reg`)
    if (m.ot) parts.push(`${m.ot}h OT`)
    if (m.km) parts.push(`${m.km} km`)
    return <p className="text-xs text-brand-700 mt-0.5 tnum">{parts.join(' · ')}</p>
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
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
      ) : error ? (
        <div className="card p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-3">
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          </div>
          <p className="font-medium text-gray-900">Couldn&apos;t load your jobs</p>
          <p className="text-sm text-gray-500 mt-1 mb-4">{error}</p>
          <button onClick={() => setReloadKey(k => k + 1)} className="btn-primary inline-flex">
            <RefreshCw className="h-4 w-4" />Try again
          </button>
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

          {(totals.reg > 0 || totals.ot > 0 || totals.km > 0) && (
            <div className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
              <span className="font-medium text-gray-700">My hours &amp; travel</span>
              <span className="text-gray-500">Regular: <strong className="text-gray-800 tnum">{totals.reg}h</strong></span>
              <span className="text-gray-500">Overtime: <strong className="text-gray-800 tnum">{totals.ot}h</strong></span>
              <span className="text-gray-500">Distance: <strong className="text-gray-800 tnum">{totals.km} km</strong></span>
            </div>
          )}

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
                      <MyLine jobId={job.id} />
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
                      <MyLine jobId={job.id} />
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
