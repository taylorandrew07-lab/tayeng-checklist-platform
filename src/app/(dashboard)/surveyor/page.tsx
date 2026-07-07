'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Loader2, CloudOff, AlertTriangle, RefreshCw, Download, ChevronDown } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, withTimeout } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import { WORKFLOW } from '@/lib/jobs/tracker'
import { useRealtimeRefresh } from '@/lib/realtime'
import { getLocalCreateDrafts, offlineAvailable } from '@/lib/offline/db'
import { loadNewJobData } from '@/lib/offline/newJobData'
import AttentionCard from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'
import UpcomingJobs from '@/components/dashboard/UpcomingJobs'

export default function SurveyorDashboard() {
  const [profile, setProfile] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  // jobId → this surveyor's own regular/OT hours + km on that job (for pay tracking).
  const [mine, setMine] = useState<Record<string, { reg: number; ot: number; km: number }>>({})
  const [localJobs, setLocalJobs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Timeframe for the work summary + CSV. Defaults to this month (pay cycle).
  const [period, setPeriod] = useState<'this_month' | 'last_month' | 'this_year' | 'all' | 'custom'>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // The pay/work summary is secondary in the field — collapsed by default so the
  // job lists sit at the top; its totals stay visible in the collapsed header.
  const [summaryOpen, setSummaryOpen] = useState(false)
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
              id, title, job_number, report_number, job_type, workflow_status, created_at, scheduled_date, vessel_name, surveyor_name,
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

  // ── Timeframe filter for the work summary + CSV ─────────────────────────────
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const monthLabel = (d: Date) => d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
  const now = new Date()
  let range: { from: string | null; to: string | null; label: string }
  if (period === 'this_month') range = { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)), label: monthLabel(now) }
  else if (period === 'last_month') { const d = new Date(now.getFullYear(), now.getMonth() - 1, 1); range = { from: ymd(d), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)), label: monthLabel(d) } }
  else if (period === 'this_year') range = { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31`, label: String(now.getFullYear()) }
  else if (period === 'custom') range = { from: customFrom || null, to: customTo || null, label: customFrom || customTo ? `${customFrom || '…'} → ${customTo || '…'}` : 'Custom range' }
  else range = { from: null, to: null, label: 'All time' }

  // Each job's date for filtering = its survey (scheduled) date, falling back to created.
  const jobDate = (j: any) => (j.scheduled_date ?? j.created_at ?? '').slice(0, 10)
  const inRange = (j: any) => { const d = jobDate(j); return (!range.from || d >= range.from) && (!range.to || d <= range.to) }

  // Bucket by the unified workflow status (kept in sync with the checklist phase).
  // Active = live to-do queue (always shown, all-time). Submitted/Completed history
  // and the summary totals + CSV are scoped to the selected timeframe.
  const active = jobs.filter(j => ['new', 'assigned', 'in_progress'].includes(j.workflow_status))
  const submittedAll = jobs.filter(j => !['new', 'assigned', 'in_progress'].includes(j.workflow_status))
  const submitted = submittedAll.filter(inRange)

  // Totals for the selected timeframe across ALL the surveyor's jobs in range.
  const periodJobs = jobs.filter(inRange)
  const totals = periodJobs.reduce((a, j) => { const m = mine[j.id]; return m ? { reg: a.reg + m.reg, ot: a.ot + m.ot, km: a.km + m.km } : a }, { reg: 0, ot: 0, km: 0 })

  // Download the selected timeframe's work as CSV (one row per job + a totals row).
  function downloadCsv() {
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const headers = ['Report #', 'Job #', 'Date', 'Vessel', 'Job type', 'Client', 'Status', 'Regular hours', 'Overtime hours', 'Distance (km)']
    const lines = [headers.join(',')]
    for (const j of periodJobs) {
      const m = mine[j.id] ?? { reg: 0, ot: 0, km: 0 }
      lines.push([
        j.report_number, j.job_number, jobDate(j), j.vessel_name, j.job_type, j.client?.name,
        WORKFLOW[j.workflow_status as keyof typeof WORKFLOW]?.label ?? j.workflow_status,
        m.reg || '', m.ot || '', m.km || '',
      ].map(esc).join(','))
    }
    lines.push(['', '', '', '', '', '', 'TOTAL', totals.reg || '', totals.ot || '', totals.km || ''].map(esc).join(','))
    // BOM + CRLF so Excel opens the UTF-8 cleanly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-work-${range.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
          {/* At-a-glance counts (the third "Total" tile was just Active+Submitted). */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-4 text-center">
              <p className="text-3xl font-bold text-yellow-600 tnum">{active.length}</p>
              <p className="text-sm text-gray-500 mt-1">Active</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-3xl font-bold text-purple-600 tnum">{submittedAll.length}</p>
              <p className="text-sm text-gray-500 mt-1">Submitted</p>
            </div>
          </div>

          {/* Your upcoming jobs in date order (scheduled soonest first), with a
              double-booking flag if two overlap. RLS scopes this to your jobs. */}
          <UpcomingJobs hrefBase="/surveyor/jobs" />

          {/* Field-first: unsynced + active jobs sit right under the header. */}
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
                        {job.template?.name} · {job.client?.name ?? 'No client'} · {formatDate(job.scheduled_date ?? job.created_at)}
                      </p>
                      <MyLine jobId={job.id} />
                    </div>
                    <WorkflowPill status={job.workflow_status} className="flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          <AttentionCard items={docAttention} />

          {/* My work summary — collapsed by default; totals stay glanceable in the
              header, the period pills + custom range + CSV live inside. The period
              still drives the Submitted/Completed list below. */}
          <div className="card p-4">
            <button onClick={() => setSummaryOpen(o => !o)} className="w-full flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-left">
              <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${summaryOpen ? '' : '-rotate-90'}`} />
                My work · {range.label} · {periodJobs.length} job{periodJobs.length === 1 ? '' : 's'}
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm pl-6">
                <span className="text-gray-500">Reg <strong className="text-gray-800 tnum">{totals.reg}h</strong></span>
                <span className="text-gray-500">OT <strong className="text-gray-800 tnum">{totals.ot}h</strong></span>
                <span className="text-gray-500">Dist <strong className="text-gray-800 tnum">{totals.km} km</strong></span>
              </span>
            </button>
            {summaryOpen && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'], ['all', 'All time'], ['custom', 'Custom']] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setPeriod(k)} className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${period === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{l}</button>
                    ))}
                  </div>
                  <button onClick={downloadCsv} disabled={periodJobs.length === 0} className="btn-secondary py-1.5 px-3 text-sm disabled:opacity-40"><Download className="h-4 w-4" />CSV</button>
                </div>
                {period === 'custom' && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div><label className="block text-[11px] text-gray-400">From</label><input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input-base py-1 text-sm" /></div>
                    <div><label className="block text-[11px] text-gray-400">To</label><input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input-base py-1 text-sm" /></div>
                  </div>
                )}
              </div>
            )}
          </div>

          {submitted.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Submitted / Completed{period !== 'all' ? ` · ${range.label}` : ''}</h2>
              <div className="space-y-3">
                {submitted.map(job => (
                  <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{job.title}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {job.template?.name} · {job.client?.name ?? 'No client'} · {formatDate(job.scheduled_date ?? job.created_at)}
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
