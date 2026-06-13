'use client'

// Jobs Tracker — an Airtable-style grid over every job. Most cells edit inline
// (report #, job type, vessel, status, date) so you rarely need to open a job;
// hours, invoice and surveyors are summarised per row; the client links to its
// record; and report numbers can be filled down the date order.

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { Plus, Search, Hash, ExternalLink, Loader2, ArrowUpDown, Clock } from 'lucide-react'
import { useRealtimeRefresh } from '@/lib/realtime'
import { formatDate } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import {
  WORKFLOW, WORKFLOW_ORDER, money, setWorkflowStatus,
  listJobTrackerRows, updateJobField, listJobTypes, fillReportNumbers, highestReportSeq, formatReportNumber,
  type TrackerRow,
} from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

type SortKey = 'report' | 'vessel' | 'type' | 'client' | 'hours' | 'status' | 'date'
type Filter = 'open' | 'paid' | 'closed' | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'paid', label: 'Paid' }, { key: 'closed', label: 'Closed' }, { key: 'all', label: 'All' },
]

const INV_PILL: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-cyan-100 text-cyan-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', void: 'bg-slate-200 text-slate-500',
}

// Shared look for an editable cell's resting (button) state.
const cellBtn = 'w-full text-left px-2 py-1 rounded-md transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400'
const cellInput = 'w-full rounded-md border border-brand-400 bg-white px-2 py-1 text-sm outline-none ring-2 ring-brand-200'

// ── Inline-edit cells ────────────────────────────────────────────────────────
function EditableText({ value, onSave, mono, placeholder }: { value: string | null; onSave: (v: string | null) => void; mono?: boolean; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  useEffect(() => { if (!editing) setV(value ?? '') }, [value, editing])
  function commit() { setEditing(false); const nv = v.trim() || null; if (nv !== (value || null)) onSave(nv) }
  if (editing) return (
    <input autoFocus value={v} placeholder={placeholder} onChange={e => setV(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setV(value ?? ''); setEditing(false) } }}
      className={`${cellInput} ${mono ? 'tnum' : ''}`} />
  )
  return (
    <button onClick={() => setEditing(true)} className={`${cellBtn} ${mono ? 'tnum' : ''} ${value ? 'text-gray-900' : 'text-gray-400'}`}>
      {value || placeholder || '—'}
    </button>
  )
}

function EditableCombo({ value, listId, onSave }: { value: string | null; listId: string; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  useEffect(() => { if (!editing) setV(value ?? '') }, [value, editing])
  function commit() { setEditing(false); const nv = v.trim() || null; if (nv !== (value || null)) onSave(nv) }
  if (editing) return (
    <input autoFocus list={listId} value={v} onChange={e => setV(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') { setV(value ?? ''); setEditing(false) } }}
      className={cellInput} />
  )
  return (
    <button onClick={() => setEditing(true)} className={`${cellBtn} ${value ? 'text-gray-700' : 'text-gray-400'}`}>
      {value || 'Set type'}
    </button>
  )
}

function EditableDate({ value, fallback, onSave }: { value: string | null; fallback?: string | null; onSave: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) return (
    <input type="date" autoFocus defaultValue={value ?? (fallback ? fallback.slice(0, 10) : '')} onBlur={e => { setEditing(false); const nv = e.target.value || null; if (nv !== (value || null)) onSave(nv) }}
      className={cellInput} />
  )
  // Scheduled date if set, otherwise the job's own date (muted) so it's never blank.
  return (
    <button onClick={() => setEditing(true)} title={value ? 'Scheduled date' : 'No scheduled date — showing the job date. Click to set.'}
      className={`${cellBtn} whitespace-nowrap ${value ? 'text-gray-600' : fallback ? 'text-gray-400 italic' : 'text-gray-400'}`}>
      {value ? formatDate(value) : fallback ? formatDate(fallback) : 'Set date'}
    </button>
  )
}

function StatusCell({ status, onChange }: { status: WorkflowStatus; onChange: (s: WorkflowStatus) => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) return (
    <select autoFocus defaultValue={status} onBlur={() => setEditing(false)}
      onChange={e => { onChange(e.target.value as WorkflowStatus); setEditing(false) }}
      className="rounded-md border border-brand-400 bg-white px-1.5 py-1 text-xs outline-none ring-2 ring-brand-200">
      {WORKFLOW_ORDER.map(s => <option key={s} value={s}>{WORKFLOW[s].label}</option>)}
    </select>
  )
  const w = WORKFLOW[status] ?? WORKFLOW.new
  return (
    <button onClick={() => setEditing(true)} title="Change status" className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400">
      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${w.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${w.dot}`} />{w.label}</span>
    </button>
  )
}

function Th({ label, col, sort, onSort, className }: { label: string; col?: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; className?: string }) {
  const base = 'sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-left text-xs font-medium'
  if (!col) return <th className={`${base} text-gray-500 ${className ?? ''}`}>{label}</th>
  const active = sort.key === col
  return (
    <th className={`${base} ${className ?? ''}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => onSort(col)} className={`inline-flex items-center gap-1 select-none rounded hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${active ? 'text-brand-700' : 'text-gray-500'}`}>
        {label}{active ? <span className="text-[10px]">{sort.dir === 'asc' ? '▲' : '▼'}</span> : <ArrowUpDown className="h-3 w-3 opacity-30" />}
      </button>
    </th>
  )
}

export default function JobsTrackerPage() {
  const [rows, setRows] = useState<TrackerRow[]>([])
  const [jobTypes, setJobTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('open')
  const [typeFilter, setTypeFilter] = useState('')
  const [surveyorFilter, setSurveyorFilter] = useState('')
  const [otOnly, setOtOnly] = useState(false)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [numberOpen, setNumberOpen] = useState(false)
  const tick = useRealtimeRefresh('jobs')
  // Suppress the realtime reload briefly after our own writes so inline edits
  // don't trigger a full-grid refresh (flicker / scroll jump) on every save.
  const suppressUntil = useRef(0)
  const firstTick = useRef(true)

  const load = useCallback(async () => {
    const [r, jt] = await Promise.all([listJobTrackerRows(), listJobTypes()])
    setRows(r); setJobTypes(jt.map(t => t.name)); setLoading(false)
  }, [])

  useEffect(() => { load() }, [load]) // initial
  useEffect(() => { // realtime — skip the first run and any reload right after our own write
    if (firstTick.current) { firstTick.current = false; return }
    if (Date.now() < suppressUntil.current) return
    load()
  }, [tick, load])

  const mutate = useCallback(async (id: string, patch: Partial<TrackerRow>, persist: () => Promise<{ error?: string }>) => {
    const prev = rows
    suppressUntil.current = Date.now() + 2500
    setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    const res = await persist()
    if (res.error) { setRows(prev); toast.error(res.error) }
  }, [rows])

  const patchRow = useCallback((id: string, patch: Partial<TrackerRow>, dbPatch: Record<string, any>) =>
    mutate(id, patch, () => updateJobField(id, dbPatch)), [mutate])
  const changeStatus = useCallback((id: string, status: WorkflowStatus) =>
    mutate(id, { workflow_status: status }, () => setWorkflowStatus(id, status)), [mutate])

  function handleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' })
  }

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    const filtered = rows.filter(r => {
      const ws = r.workflow_status
      const pass = filter === 'all' ? true : filter === 'paid' ? ws === 'paid' : filter === 'closed' ? ws === 'closed' : (ws !== 'paid' && ws !== 'closed')
      if (!pass) return false
      if (typeFilter && (r.job_type ?? '') !== typeFilter) return false
      if (otOnly && !r.is_overtime) return false
      if (surveyorFilter && !r.surveyors.includes(surveyorFilter)) return false
      if (!term) return true
      return [r.report_number, r.vessel_name, r.client_name, r.job_type, r.title, r.invoice_number, ...r.surveyors]
        .some(v => (v ?? '').toString().toLowerCase().includes(term))
    })
    const val = (r: TrackerRow): string | number => {
      switch (sort.key) {
        case 'report': return r.report_number ?? ''
        case 'vessel': return (r.vessel_name ?? '').toLowerCase()
        case 'type': return (r.job_type ?? '').toLowerCase()
        case 'client': return (r.client_name ?? '').toLowerCase()
        case 'hours': return r.regular_hours + r.overtime_hours
        case 'status': return WORKFLOW_ORDER.indexOf(r.workflow_status)
        case 'date': default: return r.scheduled_date ?? r.created_at
      }
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -dir : va > vb ? dir : 0 })
  }, [rows, filter, typeFilter, surveyorFilter, otOnly, q, sort])

  const missingCount = rows.filter(r => !r.report_number).length
  const typeOptions = useMemo(
    () => Array.from(new Set([...jobTypes, ...rows.map(r => r.job_type).filter(Boolean) as string[]])).sort(),
    [jobTypes, rows],
  )
  const surveyorOptions = useMemo(
    () => Array.from(new Set(rows.flatMap(r => r.surveyors))).sort(),
    [rows],
  )
  const otCount = rows.filter(r => r.is_overtime).length
  const filtersActive = !!typeFilter || !!surveyorFilter || otOnly

  return (
    <div className="space-y-5 animate-rise">
      <datalist id="jobTypeOptions">{typeOptions.map(t => <option key={t} value={t} />)}</datalist>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Jobs Tracker</h1>
          <p className="text-gray-500 mt-1 text-sm">{loading ? '…' : `${visible.length} job${visible.length !== 1 ? 's' : ''}`}{missingCount > 0 && !loading ? ` · ${missingCount} missing report #` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {missingCount > 0 && (
            <button onClick={() => setNumberOpen(true)} className="btn-secondary"><Hash className="h-4 w-4" /><span className="hidden sm:inline">Number reports</span></button>
          )}
          <Link href="/admin/jobs/new" className="btn-primary"><Plus className="h-4 w-4" />New Job</Link>
        </div>
      </div>

      {/* Toolbar: search + filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} aria-label="Search jobs" placeholder="Search vessel, report #, client, surveyor…" className="input-base pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={`text-sm px-3 py-1 rounded-full border transition-colors ${filter === f.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Secondary filters: type · surveyor · overtime */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="Filter by job type"
          className={`text-sm rounded-lg border px-2.5 py-1.5 transition-colors ${typeFilter ? 'border-brand-400 text-brand-700 bg-brand-50' : 'border-gray-300 text-gray-600 bg-white'}`}>
          <option value="">All types</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={surveyorFilter} onChange={e => setSurveyorFilter(e.target.value)} aria-label="Filter by surveyor"
          className={`text-sm rounded-lg border px-2.5 py-1.5 transition-colors ${surveyorFilter ? 'border-brand-400 text-brand-700 bg-brand-50' : 'border-gray-300 text-gray-600 bg-white'}`}>
          <option value="">All surveyors</option>
          {surveyorOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {otCount > 0 && (
          <button onClick={() => setOtOnly(v => !v)} aria-pressed={otOnly}
            className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors ${otOnly ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
            <Clock className="h-3.5 w-3.5" />Overtime only
          </button>
        )}
        {filtersActive && (
          <button onClick={() => { setTypeFilter(''); setSurveyorFilter(''); setOtOnly(false) }} className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5">Clear</button>
        )}
      </div>

      {/* Grid — own scroll region with a frozen header */}
      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[calc(100vh-15rem)]">
          <table className="w-full text-sm min-w-[1180px]">
            <thead>
              <tr>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 w-9 px-2 py-2.5" />
                <Th label="Report #" col="report" sort={sort} onSort={handleSort} />
                <Th label="Type" col="type" sort={sort} onSort={handleSort} />
                <Th label="Vessel" col="vessel" sort={sort} onSort={handleSort} />
                <Th label="Client" col="client" sort={sort} onSort={handleSort} />
                <Th label="Surveyors" sort={sort} onSort={handleSort} />
                <Th label="Hours" col="hours" sort={sort} onSort={handleSort} className="!text-right" />
                <Th label="Invoice" sort={sort} onSort={handleSort} />
                <Th label="Status" col="status" sort={sort} onSort={handleSort} />
                <Th label="Date" col="date" sort={sort} onSort={handleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [0, 1, 2, 3, 4, 5].map(i => (
                  <tr key={i}>{Array.from({ length: 10 }).map((_, k) => <td key={k} className="px-3 py-2.5"><div className="skeleton h-3.5 w-16" /></td>)}</tr>
                ))
              ) : visible.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">{q || filter !== 'all' ? 'No jobs match.' : <>No jobs yet. <Link href="/admin/jobs/new" className="text-brand-600 hover:underline">Create one →</Link></>}</td></tr>
              ) : visible.map(r => (
                <tr key={r.id} className="hover:bg-gray-50/70 transition-colors duration-100 align-middle">
                  <td className="px-2 py-1.5">
                    <Link href={`/admin/jobs/${r.id}`} title="Open job" aria-label="Open job" className="inline-flex p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><ExternalLink className="h-4 w-4" /></Link>
                  </td>
                  <td className="py-1.5 pr-2"><EditableText value={r.report_number} mono placeholder="—" onSave={v => patchRow(r.id, { report_number: v }, { report_number: v })} /></td>
                  <td className="py-1.5 pr-2 min-w-[120px]"><EditableCombo value={r.job_type} listId="jobTypeOptions" onSave={v => patchRow(r.id, { job_type: v }, { job_type: v })} /></td>
                  <td className="py-1.5 pr-2 min-w-[130px]"><EditableText value={r.vessel_name} placeholder="Set vessel" onSave={v => patchRow(r.id, { vessel_name: v }, { vessel_name: v })} /></td>
                  <td className="px-3 py-1.5">
                    {r.client_name
                      ? <Link href={`/admin/clients?focus=${r.client_id}`} className="text-brand-700 hover:underline">{r.client_name}</Link>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600">
                    {r.surveyors.length === 0 ? <span className="text-gray-300">—</span>
                      : r.surveyors.length === 1 ? r.surveyors[0]
                      : <span title={r.surveyors.join(', ')}>{r.surveyors[0]} <span className="text-gray-400">+{r.surveyors.length - 1}</span></span>}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 justify-end">
                      {r.is_overtime && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium" title="Overtime job">OT</span>}
                      {r.regular_hours + r.overtime_hours === 0
                        ? <span className="text-gray-300 tnum">—</span>
                        : <span className="text-gray-700 tnum">{r.regular_hours || 0}h{r.overtime_hours ? <span className="text-amber-600"> +{r.overtime_hours} OT</span> : ''}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {r.invoice_number ? (
                      <Link href={`/admin/jobs/${r.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                        <span className="tnum text-gray-700">{r.invoice_number}</span>
                        {r.invoice_status && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${INV_PILL[r.invoice_status] ?? ''}`}>{r.invoice_status}</span>}
                      </Link>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-1.5"><StatusCell status={r.workflow_status} onChange={s => changeStatus(r.id, s)} /></td>
                  <td className="py-1.5 pr-2 min-w-[120px]"><EditableDate value={r.scheduled_date} fallback={r.created_at} onSave={v => patchRow(r.id, { scheduled_date: v }, { scheduled_date: v })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <NumberReportsModal open={numberOpen} onClose={() => setNumberOpen(false)} rows={rows} onDone={load} />
    </div>
  )
}

function NumberReportsModal({ open, onClose, rows, onDone }: { open: boolean; onClose: () => void; rows: TrackerRow[]; onDone: () => void }) {
  const missing = rows.filter(r => !r.report_number)
    .sort((a, b) => { const da = a.scheduled_date ?? a.created_at, db = b.scheduled_date ?? b.created_at; return da < db ? -1 : da > db ? 1 : 0 })
  const [start, setStart] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setStart(String(highestReportSeq(rows) + 1)) }, [open, rows])

  const startSeq = parseInt(start, 10) || 1
  const preview = missing.slice(0, 3).map((r, i) => formatReportNumber(r.scheduled_date ?? r.created_at, startSeq + i))

  async function run() {
    setBusy(true)
    const res = await fillReportNumbers(rows, startSeq)
    setBusy(false)
    if (res.error) { toast.error(`${res.error} (assigned ${res.count})`); onDone(); onClose(); return }
    toast.success(`Numbered ${res.count} job${res.count !== 1 ? 's' : ''}`); onDone(); onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title="Number reports" size="sm"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={run} disabled={busy || missing.length === 0} className="btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hash className="h-4 w-4" />}Assign {missing.length}</button>
      </>}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Assigns report numbers to the <strong>{missing.length}</strong> job{missing.length !== 1 ? 's' : ''} that don&apos;t have one, in date order, as <span className="tnum">YY-MM-NNN</span> using each job&apos;s date.
        </p>
        <div>
          <label className="label-base">Start at number</label>
          <input type="number" min={1} value={start} onChange={e => setStart(e.target.value)} className="input-base w-32 tnum" />
          <p className="text-[11px] text-gray-400 mt-1">The running NNN. Defaults to one past the highest existing number.</p>
        </div>
        {preview.length > 0 && (
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 text-sm">
            <p className="text-[11px] text-gray-400 mb-1">Preview</p>
            <p className="tnum text-gray-700">{preview.join(', ')}{missing.length > 3 ? ' …' : ''}</p>
          </div>
        )}
      </div>
    </Modal>
  )
}
