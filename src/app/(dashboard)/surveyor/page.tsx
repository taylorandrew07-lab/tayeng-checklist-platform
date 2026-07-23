'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, Loader2, CloudOff, AlertTriangle, RefreshCw, Download, ChevronDown, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatDate, withTimeout } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import EmptyState from '@/components/ui/EmptyState'
import { deliverFile, PDF_MIME } from '@/lib/pdf/deliver'
import { WORKFLOW } from '@/lib/jobs/tracker'
import { jobLastDate, jobSpansDays, byLastDateDesc } from '@/lib/jobs/jobDate'
import { asLabourUnit, labourLabels, qtyWithUnit, splitQty } from '@/lib/jobs/labourUnit'
import { useRealtimeRefresh } from '@/lib/realtime'
import { getLocalCreateDrafts, offlineAvailable } from '@/lib/offline/db'
import { loadNewJobData } from '@/lib/offline/newJobData'
import { toast } from '@/components/ui/toast'
import AttentionCard from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'

export default function SurveyorDashboard() {
  const [profile, setProfile] = useState<any>(null)
  const [jobs, setJobs] = useState<any[]>([])
  // jobId → this surveyor's own regular/OT hours + km on that job (for pay tracking).
  const [mine, setMine] = useState<Record<string, { reg: number; ot: number; km: number }>>({})
  const [localJobs, setLocalJobs] = useState<any[]>([])
  // Open jobs the surveyor isn't on yet — they can add themselves to log their times
  // (mig 152). Empty offline (it's a live join) and when there's nothing to join.
  const [joinable, setJoinable] = useState<any[]>([])
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Timeframe for the work summary + CSV. Defaults to this month (pay cycle).
  const [period, setPeriod] = useState<'this_month' | 'last_month' | 'this_year' | 'all' | 'custom'>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // The work summary is where a surveyor verifies their month — open by default so
  // the period picker, per-vessel breakdown and export are right there. The glanceable
  // totals stay in the header when collapsed.
  const [summaryOpen, setSummaryOpen] = useState(true)
  const [statementBusy, setStatementBusy] = useState(false)
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
              id, title, job_number, report_number, job_type, workflow_status, created_at, scheduled_date, end_date, labour_unit, vessel_name, surveyor_name, port_location,
              template:checklist_templates(name),
              client:clients(name)
            `)
            .or(orParts.join(','))
            .order('created_at', { ascending: false }),
          15_000, 'Loading your jobs')
        if (jRes.error) throw jRes.error
        if (!active) return

        setProfile(pRes.data)
        // Ordered by created_at on the wire (PostgREST can't ORDER BY a COALESCE),
        // then re-sorted here by the job's LAST day so the cards run in the same
        // order as the dates printed on them.
        setJobs([...(jRes.data ?? [])].sort(byLastDateDesc))
        setMine(mineMap)

        // Open jobs this surveyor ISN'T on yet — so they can add themselves and log
        // their hours (e.g. a cargo loadout the office set up). RLS already lets a
        // surveyor read every job (mig 056) and join any OPEN one (mig 152 =
        // job_is_open = not 'closed'), so match that: any non-closed job, not just
        // in_progress — a report-ready/invoice-ready job is still open and still
        // takes km/OT (mig 117). Drop the ones they're already on. Online-only: a
        // failed fetch just leaves the section empty (never blocks the board).
        const mineIds = new Set((jRes.data ?? []).map((x: any) => x.id))
        const jn = await withTimeout(
          supabase.from('jobs')
            .select(`
              id, title, job_number, job_type, workflow_status, created_at, scheduled_date, end_date, vessel_name, surveyor_name,
              template:checklist_templates(name),
              client:clients(name)
            `)
            .neq('workflow_status', 'closed')
            .order('created_at', { ascending: false }),
          15_000, 'Loading jobs you can join').catch(() => ({ data: [] as any[] }))
        if (active) setJoinable([...((jn.data ?? []) as any[])].filter(j => !mineIds.has(j.id)).sort(byLastDateDesc))

        // Jobs started offline live only on this device until they sync — surface
        // them so the surveyor can reopen them (server list won't include them yet).
        if (offlineAvailable()) {
          const serverIds = new Set((jRes.data ?? []).map((x: any) => x.id))
          const drafts = await getLocalCreateDrafts(session.user.id).catch(() => [])
          // Carry the draft's last sync failure onto the card — an RLS rejection or
          // a dropped request otherwise leaves the surveyor looking at a permanent
          // "Will sync" pill with no idea why the job never reached the office.
          if (active) setLocalJobs(drafts.filter(d => !serverIds.has(d.jobId)).map(d => ({ ...d.job, syncError: d.syncError })))
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

  // Each job's date for filtering = its survey (scheduled) date, falling back to
  // created. This is the pay-period rule, NOT the list-display rule: it mirrors the
  // day-worked attribution in metrics_labour (mig 123/125/126), so a job that runs
  // 28 Jun → 2 Jul counts as June work here exactly as it does in the Finance pay
  // run. Do not switch it to the job's last day (jobLastDate) on its own — the
  // surveyor's CSV would stop reconciling with the company's totals.
  const jobDate = (j: any) => (j.scheduled_date ?? j.created_at ?? '').slice(0, 10)
  const inRange = (j: any) => { const d = jobDate(j); return (!range.from || d >= range.from) && (!range.to || d <= range.to) }

  // Bucket by OPEN vs CLOSED, not by in_progress. A job stays editable — the surveyor
  // can still add km/OT — on ANY non-closed status (mig 117 job_is_open), so every open
  // job (in_progress / report_ready / invoice_ready) is ALWAYS shown, all-time; a job
  // that advanced to report_ready must never fall off the board just because its date is
  // outside the current pay period. Only CLOSED jobs are history and get period-scoped.
  const active = jobs.filter(j => j.workflow_status !== 'closed')
  const submittedAll = jobs.filter(j => j.workflow_status === 'closed')
  const submitted = submittedAll.filter(inRange)

  // Totals for the selected timeframe across ALL the surveyor's jobs in range.
  // Hours-billed and day-billed jobs are counted into separate buckets and shown
  // side by side (mig 148) — adding 8 hours to 2 days would be a meaningless number
  // on the very screen a surveyor checks their pay against.
  const periodJobs = jobs.filter(inRange)
  const totals = periodJobs.reduce((a, j) => {
    const m = mine[j.id]
    if (!m) return a
    const d = asLabourUnit(j.labour_unit) === 'days'
    return {
      reg: a.reg + (d ? 0 : m.reg), ot: a.ot + (d ? 0 : m.ot),
      regDays: a.regDays + (d ? m.reg : 0), otDays: a.otDays + (d ? m.ot : 0),
      km: a.km + m.km,
    }
  }, { reg: 0, ot: 0, regDays: 0, otDays: 0, km: 0 })

  // Month-by-month breakdown for the year view, so a surveyor can see their workload
  // trend across the year (all 12 months, empty ones shown as a dash).
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthly = period !== 'this_year' ? [] : MONTHS.map((label, mi) => {
    const t = periodJobs.reduce((a, j) => {
      const d = jobDate(j)
      if (!d || Number(d.slice(5, 7)) !== mi + 1) return a
      const m = mine[j.id]
      if (!m) return { ...a, jobs: a.jobs + 1 }
      const isDays = asLabourUnit(j.labour_unit) === 'days'
      return {
        reg: a.reg + (isDays ? 0 : m.reg), ot: a.ot + (isDays ? 0 : m.ot),
        regDays: a.regDays + (isDays ? m.reg : 0), otDays: a.otDays + (isDays ? m.ot : 0),
        km: a.km + m.km, jobs: a.jobs + 1,
      }
    }, { reg: 0, ot: 0, regDays: 0, otDays: 0, km: 0, jobs: 0 })
    return { label, ...t }
  })

  // Download the selected timeframe's work as CSV (one row per job + a totals row).
  function downloadCsv() {
    const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    // Each row carries its job's unit and the totals are per unit — a spreadsheet
    // must never be able to add an hours quantity to a days one (mig 148).
    const headers = ['Report #', 'Job #', 'Date', 'Vessel', 'Job type', 'Port / Location', 'Client', 'Status', 'Unit', 'Regular qty', 'Overtime qty', 'Distance (km)']
    const lines = [headers.join(',')]
    for (const j of periodJobs) {
      const m = mine[j.id] ?? { reg: 0, ot: 0, km: 0 }
      lines.push([
        j.report_number, j.job_number, jobDate(j), j.vessel_name, j.job_type, j.port_location, j.client?.name,
        WORKFLOW[j.workflow_status as keyof typeof WORKFLOW]?.label ?? j.workflow_status,
        labourLabels(j.labour_unit).noun, m.reg || '', m.ot || '', m.km || '',
      ].map(esc).join(','))
    }
    lines.push(['', '', '', '', '', '', '', 'TOTAL (hours)', 'hours', totals.reg || '', totals.ot || '', totals.km || ''].map(esc).join(','))
    if (totals.regDays || totals.otDays) {
      lines.push(['', '', '', '', '', '', '', 'TOTAL (days)', 'days', totals.regDays || '', totals.otDays || '', ''].map(esc).join(','))
    }
    // BOM + CRLF so Excel opens the UTF-8 cleanly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `my-work-${range.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // A clean, branded PDF work statement for the selected period — the jobs, tallied
  // and totalled by vessel. Mobile-aware delivery (share sheet on a phone, save on
  // desktop). react-pdf is code-split so it never loads on the field board itself.
  async function downloadStatement() {
    if (!periodJobs.length) return
    setStatementBusy(true)
    try {
      const rows = periodJobs.map(j => {
        const m = mine[j.id] ?? { reg: 0, ot: 0, km: 0 }
        return {
          date: jobDate(j),
          vessel: j.vessel_name || j.title || '—',
          client: j.client?.name ?? '—',
          reg: m.reg ? qtyWithUnit(m.reg, j.labour_unit) : '—',
          ot: m.ot ? qtyWithUnit(m.ot, j.labour_unit) : '—',
          km: m.km ? String(m.km) : '—',
        }
      })
      const [{ pdf }, { SurveyorStatementPDF }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/lib/pdf/SurveyorStatementPDF'),
      ])
      const blob = await pdf(
        <SurveyorStatementPDF
          surveyorName={profile?.full_name ?? 'Surveyor'}
          periodLabel={range.label}
          generatedLabel={formatDate(ymd(new Date()))}
          rows={rows}
          totalReg={splitQty(totals.reg, totals.regDays) || '—'}
          totalOt={splitQty(totals.ot, totals.otDays) || '—'}
          totalKm={`${totals.km} km`}
        />,
      ).toBlob()
      await deliverFile(blob, `work-statement-${range.label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`, PDF_MIME, { title: 'Work statement' })
    } catch (e: any) {
      toast.error(e?.message ?? 'Could not create the statement')
    } finally {
      setStatementBusy(false)
    }
  }

  // Add myself to an open job (mig 152) so I can log my hours/OT/km on it. The row
  // lands under my own session; the mig-152 policy checks surveyor_id = me + open.
  // On success we reload so the job hops from "can join" into Active Jobs.
  async function joinJob(jobId: string) {
    if (!profile?.id) return
    setJoiningId(jobId)
    try {
      const supabase = createClient()
      const { error: jErr } = await supabase.from('job_surveyors')
        .insert({ job_id: jobId, surveyor_id: profile.id, created_by: profile.id })
      // A join failure is a per-job problem — surface it on a toast, NOT the shared
      // `error` state, which would replace the whole board with "Couldn't load your jobs".
      if (jErr) { toast.error(`Couldn't add you to that job: ${jErr.message}`); return }
      toast.success('Added you to the job — you can log your hours now.')
      setReloadKey(k => k + 1)
    } finally {
      setJoiningId(null)
    }
  }

  // What a job card shows as its date: the job's LAST day, with a multi-day job
  // noting where it started. (Separate from jobDate() above, which is the pay window.)
  const jobDateLabel = (j: any) => jobSpansDays(j)
    ? `${formatDate(jobLastDate(j))} (from ${formatDate(j.scheduled_date)})`
    : formatDate(jobLastDate(j) ?? j.created_at)

  // The surveyor's own quantity + km on a job, shown under the card title for pay
  // tracking. One job has one unit, so its own numbers can carry it directly.
  function MyLine({ jobId, unit }: { jobId: string; unit?: string | null }) {
    const m = mine[jobId]
    if (!m || (!m.reg && !m.ot && !m.km)) return null
    const parts: string[] = []
    if (m.reg) parts.push(`${qtyWithUnit(m.reg, unit)} reg`)
    if (m.ot) parts.push(`${qtyWithUnit(m.ot, unit)} OT`)
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
        <Link href="/surveyor/jobs/new" className="btn-primary min-h-11 sm:min-h-0">
          <Plus className="h-4 w-4" />New Job
        </Link>
      </div>

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="skeleton h-24 w-full" />)}</div>
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
          {/* At-a-glance counts: open (still workable) vs closed (invoiced history). */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card p-4 text-center">
              <p className="text-3xl font-bold text-yellow-600 tnum">{active.length}</p>
              <p className="text-sm text-gray-500 mt-1">Open</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-3xl font-bold text-purple-600 tnum">{submittedAll.length}</p>
              <p className="text-sm text-gray-500 mt-1">Completed</p>
            </div>
          </div>

          {/* Field-first: unsynced + active jobs sit right under the header. */}
          {localJobs.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Saved on this device — not yet synced</h2>
              <div className="space-y-3">
                {localJobs.map(job => (
                  <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow border-amber-200">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 truncate">{job.title}</p>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">{job.template?.name ?? job.job_type ?? 'No checklist'} · {job.client?.name ?? 'No client'}</p>
                      {job.syncError && <p className="text-xs text-red-600 mt-1">{job.syncError}</p>}
                    </div>
                    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ${job.syncError ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      <CloudOff className="h-3 w-3" />{job.syncError ? 'Not sent' : 'Will sync'}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {active.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Open Jobs</h2>
              <div className="space-y-3">
                {active.map(job => (
                  <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{job.title}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {job.template?.name ?? job.job_type ?? 'No checklist'} · {job.client?.name ?? 'No client'} · {jobDateLabel(job)}
                      </p>
                      <MyLine jobId={job.id} unit={job.labour_unit} />
                    </div>
                    <WorkflowPill status={job.workflow_status} className="flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Jobs someone else set up that are still open — add yourself to log your
              own hours/OT/km (e.g. a cargo loadout the office created). Online-only. */}
          {joinable.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Jobs you can join</h2>
              <p className="text-sm text-gray-500 -mt-2 mb-3">Open jobs you&apos;re not on yet. Add yourself to log your hours, overtime and distance.</p>
              <div className="space-y-3">
                {joinable.map(job => (
                  <div key={job.id} className="card p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{job.title}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {job.template?.name ?? job.job_type ?? 'No checklist'} · {job.client?.name ?? 'No client'} · {jobDateLabel(job)}
                      </p>
                    </div>
                    <button
                      onClick={() => joinJob(job.id)}
                      disabled={joiningId === job.id}
                      className="btn-secondary py-2 px-3 text-sm flex-shrink-0 min-h-11 sm:min-h-0 disabled:opacity-50"
                    >
                      {joiningId === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Add me
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <AttentionCard items={docAttention} />

          {/* My work summary — the surveyor's own record: totals, a per-vessel
              breakdown for the chosen period, and a printable statement. Open by
              default; the header totals stay visible when collapsed. The period also
              drives the Completed list below. */}
          <div className="card p-4">
            <button onClick={() => setSummaryOpen(o => !o)} className="w-full flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-left">
              <span className="flex items-center gap-2 text-sm font-semibold text-gray-800">
                <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${summaryOpen ? '' : '-rotate-90'}`} />
                My work · {range.label} · {periodJobs.length} job{periodJobs.length === 1 ? '' : 's'}
              </span>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm pl-6">
                <span className="text-gray-500">Reg <strong className="text-gray-800 tnum">{splitQty(totals.reg, totals.regDays) || '0 h'}</strong></span>
                <span className="text-gray-500">OT <strong className="text-gray-800 tnum">{splitQty(totals.ot, totals.otDays) || '0 h'}</strong></span>
                <span className="text-gray-500">Dist <strong className="text-gray-800 tnum">{totals.km} km</strong></span>
              </span>
            </button>
            {summaryOpen && (
              <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                {/* Period picker — ~44px tap targets for the field. */}
                <div className="flex flex-wrap gap-1.5">
                  {([['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'], ['all', 'All time'], ['custom', 'Custom']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setPeriod(k)} className={`min-h-11 sm:min-h-[38px] px-3.5 rounded-lg text-sm font-medium border transition-colors active:scale-[0.98] ${period === k ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>{l}</button>
                  ))}
                </div>
                {period === 'custom' && (
                  <div className="flex flex-wrap items-end gap-2">
                    <div><label className="block text-[11px] text-gray-400">From</label><input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="input-base py-2 text-sm" /></div>
                    <div><label className="block text-[11px] text-gray-400">To</label><input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="input-base py-2 text-sm" /></div>
                  </div>
                )}

                {/* Breakdown: month-by-month for the year, per-vessel otherwise —
                    both tallied + totalled (hours and days never summed). */}
                {periodJobs.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No jobs in this period.</p>
                ) : period === 'this_year' ? (
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 bg-gray-50/60">
                          <th className="font-medium py-2 px-3">Month</th>
                          <th className="font-medium py-2 px-2 text-right">Jobs</th>
                          <th className="font-medium py-2 px-2 text-right">Reg</th>
                          <th className="font-medium py-2 px-2 text-right">OT</th>
                          <th className="font-medium py-2 px-3 text-right">Km</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthly.map(mo => (
                          <tr key={mo.label} className={`border-t border-gray-50 ${mo.jobs === 0 ? 'text-gray-300' : ''}`}>
                            <td className="py-2 px-3 text-gray-800">{mo.label}</td>
                            <td className="py-2 px-2 text-right tnum">{mo.jobs || '—'}</td>
                            <td className="py-2 px-2 text-right tnum">{splitQty(mo.reg, mo.regDays) || '—'}</td>
                            <td className="py-2 px-2 text-right tnum">{splitQty(mo.ot, mo.otDays) || '—'}</td>
                            <td className="py-2 px-3 text-right tnum">{mo.km || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-200 font-semibold">
                          <td className="py-2 px-3 text-gray-800">Total</td>
                          <td className="py-2 px-2 text-right tnum text-gray-900">{periodJobs.length}</td>
                          <td className="py-2 px-2 text-right tnum text-gray-900">{splitQty(totals.reg, totals.regDays) || '—'}</td>
                          <td className="py-2 px-2 text-right tnum text-gray-900">{splitQty(totals.ot, totals.otDays) || '—'}</td>
                          <td className="py-2 px-3 text-right tnum text-gray-900">{totals.km || '—'}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-gray-100">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-400 bg-gray-50/60">
                          <th className="font-medium py-2 px-3">Vessel</th>
                          <th className="font-medium py-2 px-2 text-right">Reg</th>
                          <th className="font-medium py-2 px-2 text-right">OT</th>
                          <th className="font-medium py-2 px-3 text-right">Km</th>
                        </tr>
                      </thead>
                      <tbody>
                        {periodJobs.map(j => {
                          const m = mine[j.id] ?? { reg: 0, ot: 0, km: 0 }
                          return (
                            <tr key={j.id} className="border-t border-gray-50">
                              <td className="py-2 px-3">
                                <span className="text-gray-800">{j.vessel_name || j.title}</span>
                                <span className="block text-xs text-gray-400">{jobDateLabel(j)}</span>
                              </td>
                              <td className="py-2 px-2 text-right tnum text-gray-700">{m.reg ? qtyWithUnit(m.reg, j.labour_unit) : '—'}</td>
                              <td className="py-2 px-2 text-right tnum text-gray-700">{m.ot ? qtyWithUnit(m.ot, j.labour_unit) : '—'}</td>
                              <td className="py-2 px-3 text-right tnum text-gray-700">{m.km || '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-200 font-semibold">
                          <td className="py-2 px-3 text-gray-800">Total</td>
                          <td className="py-2 px-2 text-right tnum text-gray-900">{splitQty(totals.reg, totals.regDays) || '—'}</td>
                          <td className="py-2 px-2 text-right tnum text-gray-900">{splitQty(totals.ot, totals.otDays) || '—'}</td>
                          <td className="py-2 px-3 text-right tnum text-gray-900">{totals.km || '—'}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Export: printable statement + raw CSV. */}
                <div className="flex flex-wrap gap-2">
                  <button onClick={downloadStatement} disabled={periodJobs.length === 0 || statementBusy} className="btn-primary py-2 px-3 text-sm min-h-11 sm:min-h-0 disabled:opacity-40">
                    {statementBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    Statement (PDF)
                  </button>
                  <button onClick={downloadCsv} disabled={periodJobs.length === 0} className="btn-secondary py-2 px-3 text-sm min-h-11 sm:min-h-0 disabled:opacity-40"><Download className="h-4 w-4" />CSV</button>
                </div>
              </div>
            )}
          </div>

          {submitted.length > 0 && (
            <div>
              <h2 className="section-title mb-3">Completed{period !== 'all' ? ` · ${range.label}` : ''}</h2>
              <div className="space-y-3">
                {submitted.map(job => (
                  <Link key={job.id} href={`/surveyor/jobs/${job.id}`} className="card p-4 flex items-center gap-4 hover:shadow-md transition-shadow">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{job.title}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5 truncate">
                        {job.template?.name ?? job.job_type ?? 'No checklist'} · {job.client?.name ?? 'No client'} · {jobDateLabel(job)}
                      </p>
                      <MyLine jobId={job.id} unit={job.labour_unit} />
                    </div>
                    <WorkflowPill status={job.workflow_status} className="flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {jobs.length === 0 && (
            <EmptyState
              icon={Plus}
              title="No jobs yet"
              description="Start a job to log your checklist, hours and kilometres."
              action={<Link href="/surveyor/jobs/new" className="btn-primary inline-flex"><Plus className="h-4 w-4" />Start your first job</Link>}
            />
          )}
        </>
      )}
    </div>
  )
}
