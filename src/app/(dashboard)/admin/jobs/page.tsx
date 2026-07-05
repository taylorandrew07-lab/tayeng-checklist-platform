'use client'

// Jobs Tracker — an Airtable-style grid over every job. Most cells edit inline
// (report #, job type, vessel, status, date) so you rarely need to open a job;
// hours, invoice and surveyors are summarised per row; the client links to its
// record; and report numbers can be filled down the date order.

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, Search, Hash, ExternalLink, Loader2, ArrowUpDown, Clock, Download, Columns3 } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, horizontalListSortingStrategy, useSortable, arrayMove, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useRealtimeRefresh } from '@/lib/realtime'
import { getUiPrefs, setUiPref } from '@/lib/preferences'
import { formatDate, dayKey, titleCaseVesselName } from '@/lib/utils'
import { useJobsView, availableYears, inYearMonth, rowColor, buildLegend } from '@/lib/jobs/view'
import JobsViewToolbar from '@/components/job/JobsViewToolbar'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import {
  WORKFLOW, WORKFLOW_ORDER, money, setWorkflowStatus,
  listJobTrackerRows, updateJobField, listJobTypes, fillReportNumbers, highestReportSeq, formatReportNumber,
  type TrackerRow,
} from '@/lib/jobs/tracker'
import type { WorkflowStatus } from '@/lib/types/database'

type SortKey = 'report' | 'vessel' | 'type' | 'client' | 'hours' | 'regular' | 'overtime' | 'km' | 'status' | 'date'
type Filter = 'open' | 'paid' | 'closed' | 'all'

// Persisted column layout (visibility + weights + order). Bumped when the schema changes.
const COLS_STORAGE_KEY = 'te_jobs_cols_v2'
// Smallest a column may be squeezed to (px) — text truncates below this.
const MIN_COL_PX = 46
const BILLING_LABEL: Record<string, string> = { overtime: 'Overtime', regular: 'Regular', fixed: 'Fixed' }

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'paid', label: 'Paid' }, { key: 'closed', label: 'Closed' }, { key: 'all', label: 'All' },
]

const INV_PILL: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-cyan-100 text-cyan-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', void: 'bg-slate-200 text-slate-500',
}

// Shared look for an editable cell's resting (button) state.
const cellBtn = 'w-full text-left px-2 py-1 rounded-md transition-colors hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 truncate'
const cellInput = 'w-full rounded-md border border-brand-400 bg-white px-2 py-1 text-sm outline-none ring-2 ring-brand-200'

// CSV-escape one value: quote-wrap when it holds a comma/quote/newline; double quotes.
function csv(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

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

// Does this typed value mean "no report required"? (so it maps to the flag, not a
// literal report_number that would collide on the unique index).
function isNaText(v: string | null): boolean {
  const t = (v ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  return t === 'na' || t === 'notapplicable' || t === 'noreport' || t === 'none'
}

// Report number cell with an N/A selector. Many jobs don't require a report; picking
// "N/A" marks report_not_required (report_number stays null, so no unique-number clash)
// and the job stops counting as "missing a report number".
function ReportCell({ reportNumber, notRequired, onSaveNumber, onSetNA }: {
  reportNumber: string | null; notRequired: boolean
  onSaveNumber: (v: string | null) => void; onSetNA: (na: boolean) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {notRequired
        ? <span className="flex-1 px-2 text-xs italic text-gray-400 tnum">N/A</span>
        : <span className="flex-1"><EditableText value={reportNumber} mono placeholder="—" onSave={onSaveNumber} /></span>}
      <select
        value={notRequired ? 'na' : 'num'}
        onChange={e => onSetNA(e.target.value === 'na')}
        title="Report number, or N/A if the job doesn't require a report"
        aria-label="Report number or N/A"
        className="shrink-0 cursor-pointer rounded bg-transparent px-0.5 py-0.5 text-[11px] text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <option value="num">#</option>
        <option value="na">N/A</option>
      </select>
    </div>
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

// ── Configurable columns ─────────────────────────────────────────────────────
// Each column knows how to render its own cell (inline editors get patchRow /
// changeStatus via ctx). Which columns show, and how wide they are, is chosen by
// the user (checkbox menu + drag-to-resize) and persisted in localStorage.
interface CellCtx {
  patchRow: (id: string, patch: Partial<TrackerRow>, dbPatch: Record<string, any>) => void
  changeStatus: (id: string, status: WorkflowStatus) => void
}
interface ColumnDef {
  key: string
  label: string
  sortKey?: SortKey
  defaultVisible: boolean
  width: number
  min: number
  align?: 'right'
  cell: (r: TrackerRow, ctx: CellCtx) => React.ReactNode
}

const COLUMNS: ColumnDef[] = [
  { key: 'report', label: 'Report #', sortKey: 'report', defaultVisible: true, width: 130, min: 90,
    cell: (r, { patchRow }) => (
      <ReportCell reportNumber={r.report_number} notRequired={r.report_not_required}
        onSaveNumber={v => {
          if (isNaText(v)) { const p = { report_not_required: true, report_number: null }; return patchRow(r.id, p, p) }
          patchRow(r.id, { report_number: v, report_not_required: false }, { report_number: v, report_not_required: false })
        }}
        onSetNA={na => { const p = na ? { report_not_required: true, report_number: null } : { report_not_required: false }; patchRow(r.id, p, p) }} />
    ) },
  { key: 'type', label: 'Type', sortKey: 'type', defaultVisible: true, width: 150, min: 100,
    cell: (r, { patchRow }) => (
      <>
        <EditableCombo value={r.job_type} listId="jobTypeOptions" onSave={v => patchRow(r.id, { job_type: v }, { job_type: v })} />
        {r.job_stage && <span className="block px-2 text-[11px] text-gray-400 leading-tight truncate">{r.job_stage}</span>}
        {r.cargo_type && <span className="block px-2 text-[11px] text-gray-400 leading-tight truncate">{r.cargo_type}</span>}
      </>
    ) },
  { key: 'vessel', label: 'Vessel', sortKey: 'vessel', defaultVisible: true, width: 150, min: 100,
    cell: (r, { patchRow }) => <EditableText value={r.vessel_name} placeholder="Set vessel" onSave={v => { const nv = titleCaseVesselName(v ?? ''); return patchRow(r.id, { vessel_name: nv }, { vessel_name: nv }) }} /> },
  { key: 'client', label: 'Client', sortKey: 'client', defaultVisible: true, width: 150, min: 90,
    cell: r => r.client_name
      ? <Link href={`/admin/clients/${r.client_id}`} className="block px-3 truncate text-brand-700 hover:underline">{r.client_name}</Link>
      : <span className="block px-3 text-gray-300">—</span> },
  { key: 'surveyors', label: 'Surveyors', defaultVisible: true, width: 160, min: 90,
    cell: r => (
      <div className="px-3 text-gray-600 truncate">
        {r.surveyors.length === 0 ? <span className="text-gray-300">—</span>
          : r.surveyors.length === 1 ? r.surveyors[0]
          : <span title={r.surveyors.join(', ')}>{r.surveyors[0]} <span className="text-gray-400">+{r.surveyors.length - 1}</span></span>}
      </div>
    ) },
  { key: 'hours', label: 'Hours', sortKey: 'hours', defaultVisible: true, width: 120, min: 80, align: 'right',
    cell: r => (
      <div className="px-3 text-right whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 justify-end">
          {r.is_overtime && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-100 text-amber-700 font-medium" title="Overtime job">OT</span>}
          {r.regular_hours + r.overtime_hours === 0
            ? <span className="text-gray-300 tnum">—</span>
            : <span className="text-gray-700 tnum">{r.regular_hours || 0}h{r.overtime_hours ? <span className="text-amber-600"> +{r.overtime_hours} OT</span> : ''}</span>}
        </span>
      </div>
    ) },
  { key: 'regular', label: 'Regular (h)', sortKey: 'regular', defaultVisible: false, width: 110, min: 80, align: 'right',
    cell: r => <div className="px-3 text-right tnum text-gray-700">{r.regular_hours || <span className="text-gray-300">—</span>}</div> },
  { key: 'overtime', label: 'Overtime (h)', sortKey: 'overtime', defaultVisible: false, width: 120, min: 80, align: 'right',
    cell: r => <div className="px-3 text-right tnum">{r.overtime_hours ? <span className="text-amber-600">{r.overtime_hours}</span> : <span className="text-gray-300">—</span>}</div> },
  { key: 'km', label: 'Distance (km)', sortKey: 'km', defaultVisible: false, width: 120, min: 90, align: 'right',
    cell: r => <div className="px-3 text-right tnum text-gray-700">{r.total_km ? r.total_km : <span className="text-gray-300">—</span>}</div> },
  { key: 'billing', label: 'Billing', defaultVisible: false, width: 110, min: 80,
    cell: r => <div className="px-3 text-gray-600 truncate">{BILLING_LABEL[r.billing_mode] ?? r.billing_mode}</div> },
  { key: 'stage', label: 'Stage', defaultVisible: false, width: 110, min: 80,
    cell: r => <div className="px-3 text-gray-600 truncate">{r.job_stage || <span className="text-gray-300">—</span>}</div> },
  { key: 'cargo', label: 'Cargo', defaultVisible: false, width: 120, min: 80,
    cell: r => <div className="px-3 text-gray-600 truncate">{r.cargo_type || <span className="text-gray-300">—</span>}</div> },
  { key: 'invoice', label: 'Invoice', defaultVisible: true, width: 140, min: 90,
    cell: r => (
      <div className="px-3">
        {r.invoice_number ? (
          <Link href={`/admin/jobs/${r.id}`} className="block hover:underline">
            <span className="inline-flex items-center gap-1.5">
              <span className="tnum text-gray-700">{r.invoice_number}</span>
              {r.invoice_status && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${INV_PILL[r.invoice_status] ?? ''}`}>{r.invoice_status}</span>}
            </span>
            {r.invoice_sent_at && <span className="block text-[10px] text-gray-400 leading-tight">sent {formatDate(r.invoice_sent_at)}</span>}
          </Link>
        ) : <span className="text-gray-300">—</span>}
      </div>
    ) },
  { key: 'invoice_total', label: 'Invoice total', defaultVisible: false, width: 120, min: 90, align: 'right',
    cell: r => <div className="px-3 text-right tnum text-gray-700">{r.invoice_total != null ? money(r.invoice_total, r.invoice_currency ?? 'USD') : <span className="text-gray-300">—</span>}</div> },
  { key: 'status', label: 'Status', sortKey: 'status', defaultVisible: true, width: 120, min: 90,
    cell: (r, { changeStatus }) => <div className="px-3"><StatusCell status={r.workflow_status} onChange={s => changeStatus(r.id, s)} /></div> },
  { key: 'date', label: 'Date', sortKey: 'date', defaultVisible: true, width: 130, min: 90,
    cell: (r, { patchRow }) => (
      <>
        <EditableDate value={r.scheduled_date} fallback={r.created_at} onSave={v => patchRow(r.id, { scheduled_date: v }, { scheduled_date: v })} />
        {r.end_date && <span className="block px-2 text-[11px] text-gray-400 leading-tight">→ {formatDate(r.end_date)}</span>}
      </>
    ) },
  { key: 'end_date', label: 'End date', defaultVisible: false, width: 110, min: 90,
    cell: r => <div className="px-3 text-gray-600 whitespace-nowrap">{r.end_date ? formatDate(r.end_date) : <span className="text-gray-300">—</span>}</div> },
  { key: 'notes', label: 'Notes', defaultVisible: false, width: 220, min: 120,
    cell: r => <div className="px-3 text-gray-600 truncate" title={r.notes ?? ''}>{r.notes || <span className="text-gray-300">—</span>}</div> },
]

// Render one cell as its own component so a column's render runs in a child scope.
// (Calling col.cell(...) inline during the row map trips react-hooks/refs, because
// the inline editors transitively touch a ref — here ctx is just an opaque prop.)
function JobCell({ col, row, ctx }: { col: ColumnDef; row: TrackerRow; ctx: CellCtx }) {
  return <>{col.cell(row, ctx)}</>
}

// A header cell that (a) can be dragged left/right to reorder columns (dnd-kit),
// (b) sorts on click when it has a sortKey, and (c) carries a right-edge grip you
// drag to resize or double-click to autofit. isLast hides the grip + gridline on
// the final column so nothing dangles past the table edge.
function SortableHeaderCell({ col, sort, onSort, onResize, onAutofit, isLast }: {
  col: ColumnDef
  sort: { key: SortKey; dir: 'asc' | 'desc' }
  onSort: (k: SortKey) => void
  onResize: (e: React.PointerEvent, key: string) => void
  onAutofit: (key: string) => void
  isLast: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: col.key })
  const active = col.sortKey && sort.key === col.sortKey
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined,
  }
  return (
    <th ref={setNodeRef} style={style} data-col={col.key}
      className={`sticky top-0 z-10 bg-gray-50 border-b border-gray-200 ${isLast ? '' : 'border-r border-gray-200/80'} px-3 py-2.5 text-xs font-medium`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {/* Whole label area is the drag handle; a click with no movement still sorts. */}
      <div {...attributes} {...listeners}
        title="Drag to reorder"
        className={`flex items-center gap-1 min-w-0 cursor-grab active:cursor-grabbing touch-none ${col.align === 'right' ? 'justify-end' : ''}`}>
        {col.sortKey ? (
          <button onClick={() => onSort(col.sortKey!)} className={`inline-flex items-center gap-1 min-w-0 select-none rounded hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ${active ? 'text-brand-700' : 'text-gray-500'}`}>
            <span className="truncate">{col.label}</span>{active ? <span className="text-[10px] shrink-0">{sort.dir === 'asc' ? '▲' : '▼'}</span> : <ArrowUpDown className="h-3 w-3 opacity-30 shrink-0" />}
          </button>
        ) : <span className="text-gray-500 truncate">{col.label}</span>}
      </div>
      {!isLast && (
        <span
          onPointerDown={e => onResize(e, col.key)}
          onDoubleClick={e => { e.preventDefault(); e.stopPropagation(); onAutofit(col.key) }}
          onClick={e => e.stopPropagation()}
          title="Drag to resize · double-click to auto-fit"
          style={{ touchAction: 'none' }}
          // Sits INSIDE this column's right edge (no overhang under the next column,
          // which would otherwise cover it) and above everything so it's grabbable.
          className="group/grip absolute right-0 top-0 z-30 flex h-full w-3.5 cursor-col-resize items-stretch justify-end select-none"
        >
          {/* Always-visible hairline that thickens + turns blue on hover, so the
              resize edge is findable (and clearly not the same as the header body). */}
          <span className="w-px bg-gray-300 group-hover/grip:w-[3px] group-hover/grip:bg-brand-500 transition-all" />
        </span>
      )}
    </th>
  )
}

function ColumnsMenu({ narrow, colVisible, onToggle, onReset, onEqual, onAutofitAll }: {
  narrow: boolean
  colVisible: Record<string, boolean>
  onToggle: (k: string) => void
  onReset: () => void
  onEqual: () => void
  onAutofitAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: Event) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    // pointerdown covers both mouse and touch (mousedown alone can miss taps).
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [open])
  const count = COLUMNS.filter(c => colVisible[c.key] !== false).length

  // Shared panel contents. On desktop this sits in a button-anchored dropdown; on
  // phones that dropdown ran off the left screen edge (anchored right-0, 240px wide,
  // button near the middle), so there it becomes a centered popup with a backdrop.
  const body = (
    <>
      {/* Sizing actions — close the menu on apply so the change is visible. */}
      <div className="grid grid-cols-2 gap-1.5 px-1 pb-2 mb-1 border-b border-gray-100">
        <button onClick={() => { onEqual(); setOpen(false) }} className="text-xs font-medium text-gray-600 rounded-md border border-gray-200 px-2 py-1.5 hover:bg-gray-50" title="Give every column the same width">Make equal</button>
        <button onClick={() => { onAutofitAll(); setOpen(false) }} className="text-xs font-medium text-gray-600 rounded-md border border-gray-200 px-2 py-1.5 hover:bg-gray-50" title="Size every column to its content, still filling the page">Auto-fit all</button>
      </div>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-gray-500">Show columns ({count})</span>
        <button onClick={onReset} className="text-[11px] text-brand-600 hover:underline">Reset</button>
      </div>
      <div className="max-h-72 overflow-auto">
        {COLUMNS.map(c => (
          <label key={c.key} className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
            <input type="checkbox" checked={colVisible[c.key] !== false} onChange={() => onToggle(c.key)} className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
            <span className="text-gray-700">{c.label}</span>
          </label>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 px-2 pt-1.5 mt-1 border-t border-gray-100 leading-relaxed">
        {narrow
          ? 'Tick to show or hide a column. The grid scrolls sideways — use “Auto-fit all” or “Make equal” to size the columns.'
          : 'Drag a header to reorder · drag its right edge to resize · double-click the edge to auto-fit.'}
      </p>
    </>
  )

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="btn-secondary" title="Choose which columns to show">
        <Columns3 className="h-4 w-4" /><span className="hidden sm:inline">Columns</span>
      </button>
      {open && (narrow ? (
        // Phone: full backdrop + centered card that always fits on-screen.
        <>
          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} />
          <div className="fixed z-50 left-1/2 -translate-x-1/2 top-24 w-[calc(100vw-2rem)] max-w-sm max-h-[70vh] overflow-auto rounded-xl border border-gray-200 bg-white shadow-xl p-2">
            <div className="flex items-center justify-between px-1 pb-2 mb-1">
              <span className="text-sm font-semibold text-gray-800">Columns</span>
              <button onClick={() => setOpen(false)} className="text-sm text-gray-500 px-2 py-1 rounded-md hover:bg-gray-100">Done</button>
            </div>
            {body}
          </div>
        </>
      ) : (
        <div className="absolute right-0 mt-2 z-30 w-60 rounded-xl border border-gray-200 bg-white shadow-lg p-2">
          {body}
        </div>
      ))}
    </div>
  )
}

// Render in pages to keep the DOM small on big job lists. Filtering/sorting still
// run over the full set; this only limits how many rows are painted at once.
const PAGE_SIZE = 50

// True on phone-width screens. The grid's "fit exactly one page" model crams 8
// columns into ~360px (every cell truncates to "F…"), and its edge-drag resize is
// unusable by touch — so on narrow screens we switch to a horizontally-scrollable
// spreadsheet with real per-column widths instead.
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
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
  const [shown, setShown] = useState(PAGE_SIZE)
  const [numberOpen, setNumberOpen] = useState(false)
  const narrow = useIsNarrow()
  const tick = useRealtimeRefresh('jobs')
  // Suppress the realtime reload briefly after our own writes so inline edits
  // don't trigger a full-grid refresh (flicker / scroll jump) on every save.
  const suppressUntil = useRef(0)
  const firstTick = useRef(true)
  const router = useRouter()
  const pathname = usePathname()
  const didInitUrl = useRef(false)

  // Column layout — chosen by the user. The table ALWAYS fills exactly one page:
  // widths are relative "weights" (not pixels), rendered as a share of the
  // available width, so it never scrolls sideways and never gaps. Order is a
  // separate list so columns can be dragged to reorder.
  //
  // Persistence is account-based: the layout is stored on the user's profile
  // (profiles.ui_prefs.jobs_cols) so a choice made on the desktop shows up on the
  // phone and vice-versa. localStorage is kept only as an instant-paint cache /
  // offline fallback; the account copy is the source of truth.
  const byKey = useMemo(() => Object.fromEntries(COLUMNS.map(c => [c.key, c])) as Record<string, ColumnDef>, [])
  const [colVisible, setColVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(COLUMNS.map(c => [c.key, c.defaultVisible])))
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries(COLUMNS.map(c => [c.key, c.width])))
  const [colOrder, setColOrder] = useState<string[]>(() => COLUMNS.map(c => c.key))
  const [colsLoaded, setColsLoaded] = useState(false)
  // Gate account writes until the account copy has been read, so the local default
  // never clobbers a layout saved on another device before we've loaded it.
  const remoteSaveReady = useRef(false)
  const tableRef = useRef<HTMLTableElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const measureCanvas = useRef<HTMLCanvasElement | null>(null)
  // Live width of the scroll region, tracked so desktop column widths can be REAL
  // pixels. (calc()/% widths on <col> under table-layout:fixed are unreliable —
  // browsers often ignore them, which is why resizing did nothing. px is honoured.)
  const [availWidth, setAvailWidth] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      const next = Math.max(0, Math.floor(el.clientWidth))
      setAvailWidth(prev => prev === next ? prev : next)
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Apply a stored layout blob ({visible, weights, order}) to state, tolerating
  // partial/older shapes and unknown/renamed columns.
  const applyColsPref = useCallback((p: { visible?: Record<string, boolean>; weights?: Record<string, number>; order?: string[] } | null | undefined) => {
    if (!p) return
    if (p.visible && typeof p.visible === 'object') setColVisible(v => ({ ...v, ...p.visible }))
    if (p.weights && typeof p.weights === 'object') setWeights(w => ({ ...w, ...p.weights }))
    if (Array.isArray(p.order)) {
      const known = new Set(COLUMNS.map(c => c.key))
      const saved = p.order.filter(k => known.has(k))
      const missing = COLUMNS.map(c => c.key).filter(k => !saved.includes(k))
      setColOrder([...saved, ...missing])
    }
  }, [])

  useEffect(() => {
    // 1) Instant paint from the per-device cache (no await).
    let cached: { visible?: Record<string, boolean>; weights?: Record<string, number>; order?: string[] } | null = null
    try {
      const raw = localStorage.getItem(COLS_STORAGE_KEY)
      if (raw) cached = JSON.parse(raw)
    } catch { /* ignore corrupt/absent storage */ }
    applyColsPref(cached)
    setColsLoaded(true)

    // 2) Account copy — the cross-device source of truth. Override the cache with
    // it if present; otherwise seed the account from whatever this device had, so
    // an existing desktop layout propagates without needing a fresh change.
    ;(async () => {
      try {
        const remote = (await getUiPrefs()).jobs_cols
        if (remote && (remote.visible || remote.weights || remote.order)) {
          applyColsPref(remote)
          try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(remote)) } catch { /* quota / private mode */ }
        } else if (cached) {
          setUiPref('jobs_cols', cached).catch(() => {})
        }
      } catch { /* offline / signed out — the cache still applies */ }
      remoteSaveReady.current = true
    })()
  }, [applyColsPref])

  // Persist changes: localStorage immediately (fast, per-device), and the account
  // copy debounced (so a burst of resize drags doesn't spam writes).
  useEffect(() => {
    if (!colsLoaded) return
    const snapshot = { visible: colVisible, weights, order: colOrder }
    try { localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(snapshot)) } catch { /* quota / private mode */ }
    if (!remoteSaveReady.current) return
    const h = setTimeout(() => { setUiPref('jobs_cols', snapshot).catch(() => {}) }, 700)
    return () => clearTimeout(h)
  }, [colVisible, weights, colOrder, colsLoaded])

  const visibleColumns = useMemo(
    () => colOrder.map(k => byKey[k]).filter((c): c is ColumnDef => !!c && colVisible[c.key] !== false),
    [colOrder, byKey, colVisible],
  )
  const wOf = useCallback((key: string) => weights[key] ?? byKey[key].width, [weights, byKey])
  const sumVisibleW = useMemo(() => visibleColumns.reduce((s, c) => s + (weights[c.key] ?? c.width), 0), [visibleColumns, weights])
  const desktopColWidths = useMemo(() => {
    const widths: Record<string, number> = {}
    if (narrow || visibleColumns.length === 0) return widths
    const available = Math.max(0, (availWidth > 36 ? availWidth : 36 + sumVisibleW) - 36)
    const total = sumVisibleW || 1
    let used = 0
    visibleColumns.forEach((c, i) => {
      const width = i === visibleColumns.length - 1
        ? Math.max(0, available - used)
        : Math.max(0, available * (wOf(c.key) / total))
      widths[c.key] = width
      used += width
    })
    return widths
  }, [availWidth, narrow, sumVisibleW, visibleColumns, wOf])
  // CSS width for a column. Desktop: a share of the row (minus the 36px open-link
  // col) so the table fills exactly one page. Narrow (phone): a real pixel width so
  // the table can grow wider than the screen and scroll sideways — readable cells
  // instead of "F…". Weights double as those px widths (never below MIN_COL_PX).
  const colWidthStyle = (key: string): string => {
    if (narrow) return `${Math.max(wOf(key), MIN_COL_PX)}px`
    return `${desktopColWidths[key] ?? byKey[key].width}px`
  }
  // Total table width in narrow mode (open-link col + every visible column).
  const narrowTableWidth = useMemo(
    () => narrow ? 36 + visibleColumns.reduce((s, c) => s + Math.max(wOf(c.key), MIN_COL_PX), 0) : 0,
    [narrow, visibleColumns, wOf],
  )
  // Live pixel width available to the weighted columns (needed for px↔weight maths).
  const dataAvailPx = () => {
    const width = narrow
      ? (tableRef.current?.clientWidth || narrowTableWidth || 900)
      : (availWidth || scrollRef.current?.clientWidth || tableRef.current?.clientWidth || 900)
    return Math.max(1, width - 36)
  }

  const toggleCol = useCallback((key: string) => {
    setColVisible(prev => {
      const next = { ...prev, [key]: prev[key] === false }
      if (COLUMNS.every(c => next[c.key] === false)) return prev // keep at least one
      return next
    })
  }, [])
  const resetCols = useCallback(() => {
    setColVisible(Object.fromEntries(COLUMNS.map(c => [c.key, c.defaultVisible])))
    setWeights(Object.fromEntries(COLUMNS.map(c => [c.key, c.width])))
    setColOrder(COLUMNS.map(c => c.key))
  }, [])

  // Measure a column's natural content width (px) from the rendered header + body
  // cells, via a canvas text metric using each cell's own font. Truncated text is
  // fully measured (we read the text, not the clipped box).
  function measureColPx(key: string): number {
    const table = tableRef.current
    const cells = table?.querySelectorAll<HTMLElement>(`[data-col="${key}"]`)
    if (!cells || !cells.length) return byKey[key].width
    const canvas = measureCanvas.current ?? (measureCanvas.current = document.createElement('canvas'))
    const cx = canvas.getContext('2d')
    if (!cx) return byKey[key].width
    let max = 0
    cells.forEach(el => {
      const cs = getComputedStyle(el)
      // getComputedStyle(el).font serialises to '' in some browsers (Firefox, and
      // inconsistently in Chrome) — build it from longhands so measurement is accurate.
      cx.font = `${cs.fontStyle || 'normal'} ${cs.fontWeight || '400'} ${cs.fontSize || '14px'} ${cs.fontFamily || 'system-ui'}`
      for (const line of (el.innerText || '').split('\n')) {
        const w = cx.measureText(line.trim()).width
        if (w > max) max = w
      }
    })
    return Math.ceil(max) + 52 // padding + room for sort arrow / pills
  }

  // Drag the divider between a column and its right neighbour: trade weight between
  // the two so the total (and every other column) stays put — the table never
  // grows past the page.
  function startResize(e: React.PointerEvent, key: string) {
    // NB: do NOT preventDefault() here — that would cancel the browser's dblclick,
    // killing double-click-to-autofit. stopPropagation is enough to keep the header
    // reorder-drag from starting.
    e.stopPropagation()
    const idx = visibleColumns.findIndex(c => c.key === key)
    if (idx < 0 || idx >= visibleColumns.length - 1) return
    const a = visibleColumns[idx].key, b = visibleColumns[idx + 1].key
    const wA0 = wOf(a), wB0 = wOf(b), pair = wA0 + wB0
    const wPerPx = sumVisibleW / dataAvailPx()
    const minW = MIN_COL_PX * wPerPx
    const startX = e.clientX
    function move(ev: PointerEvent) {
      ev.preventDefault() // stop text selection mid-drag
      const newA = Math.min(Math.max(wA0 + (ev.clientX - startX) * wPerPx, minW), pair - minW)
      setWeights(prev => ({ ...prev, [a]: newA, [b]: pair - newA }))
    }
    function up() {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  // Double-click a divider: size that one column to its content, letting the others
  // keep their relative ratios and reflow to fill the rest of the page.
  function autofitColumn(key: string) {
    if (visibleColumns.length <= 1) {
      setWeights(prev => ({ ...prev, [key]: Math.max(measureColPx(key), MIN_COL_PX) }))
      return
    }
    const avail = dataAvailPx()
    const maxTarget = Math.max(MIN_COL_PX, avail - (visibleColumns.length - 1) * MIN_COL_PX)
    const target = Math.min(Math.max(measureColPx(key), MIN_COL_PX), maxTarget)
    const Wo = visibleColumns.filter(c => c.key !== key).reduce((s, c) => s + wOf(c.key), 0)
    if (Wo <= 0) {
      setWeights(prev => ({ ...prev, [key]: target }))
      return
    }
    const wKey = avail - target > 1 ? (target * Wo) / (avail - target) : Math.max(Wo, 1) * 8
    setWeights(prev => ({ ...prev, [key]: wKey }))
  }
  // Size every visible column to its content (all still summing to one page).
  function autofitAll() {
    const next: Record<string, number> = {}
    visibleColumns.forEach(c => { next[c.key] = measureColPx(c.key) })
    setWeights(prev => ({ ...prev, ...next }))
  }
  // Every visible column the same width.
  function equalizeColumns() {
    const next: Record<string, number> = {}
    visibleColumns.forEach(c => { next[c.key] = 100 })
    setWeights(prev => ({ ...prev, ...next }))
  }

  // Drag a header onto another to reorder (operates on the full order list so
  // hidden columns keep their slots).
  const colSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function handleColDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setColOrder(prev => {
      const from = prev.indexOf(active.id as string), to = prev.indexOf(over.id as string)
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to)
    })
  }

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

  // Restore filters from the URL once, so a shared/bookmarked view reopens as-is.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const v = sp.get('view'); if (v) setFilter(v as Filter)
    const t = sp.get('type'); if (t) setTypeFilter(t)
    const s = sp.get('surveyor'); if (s) setSurveyorFilter(s)
    if (sp.get('ot') === '1') setOtOnly(true)
    const qq = sp.get('q'); if (qq) setQ(qq)
    const so = sp.get('sort'); if (so) { const [k, d] = so.split(':'); if (k) setSort({ key: k as SortKey, dir: d === 'asc' ? 'asc' : 'desc' }) }
    didInitUrl.current = true
  }, [])

  // Mirror the active view into the URL (shareable, bookmarkable, reload-safe).
  useEffect(() => {
    if (!didInitUrl.current) return
    const h = setTimeout(() => {
      const p = new URLSearchParams()
      if (filter !== 'open') p.set('view', filter)
      if (typeFilter) p.set('type', typeFilter)
      if (surveyorFilter) p.set('surveyor', surveyorFilter)
      if (otOnly) p.set('ot', '1')
      if (q.trim()) p.set('q', q.trim())
      if (!(sort.key === 'date' && sort.dir === 'desc')) p.set('sort', `${sort.key}:${sort.dir}`)
      const qs = p.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, 200)
    return () => clearTimeout(h)
  }, [filter, typeFilter, surveyorFilter, otOnly, q, sort, pathname, router])

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
  const cellCtx = useMemo<CellCtx>(() => ({ patchRow, changeStatus }), [patchRow, changeStatus])

  function handleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'asc' })
  }

  const view = useJobsView()

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    const filtered = rows.filter(r => {
      const ws = r.workflow_status
      const pass = filter === 'all' ? true : filter === 'paid' ? ws === 'paid' : filter === 'closed' ? ws === 'closed' : (ws !== 'paid' && ws !== 'closed')
      if (!pass) return false
      if (!inYearMonth(r.created_at, view.year, view.month)) return false
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
        case 'regular': return r.regular_hours
        case 'overtime': return r.overtime_hours
        case 'km': return r.total_km
        case 'status': return WORKFLOW_ORDER.indexOf(r.workflow_status)
        // Compare by the local calendar day actually shown in the Date column, so the
        // order matches the displayed dates (raw date-vs-timestamp strings don't).
        case 'date': default: return dayKey(r.scheduled_date ?? r.created_at)
      }
    }
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -dir : va > vb ? dir : 0 })
  }, [rows, filter, typeFilter, surveyorFilter, otOnly, q, sort, view.year, view.month])

  // Reset the page window whenever the filtered/sorted set changes.
  useEffect(() => { setShown(PAGE_SIZE) }, [filter, typeFilter, surveyorFilter, otOnly, q, sort, view.year, view.month])
  const paged = useMemo(() => visible.slice(0, shown), [visible, shown])

  // Colour-by years come from all rows (so the year list is stable regardless of
  // the active filter); the legend reflects the currently-visible rows.
  const jobYears = useMemo(() => availableYears(rows, r => r.created_at), [rows])
  const legend = useMemo(() => buildLegend(view.colorMode, visible.map(r => ({
    clientName: r.client_name, clientColor: r.client_color, typeName: r.template_name, typeColor: r.template_color,
  }))), [view.colorMode, visible])

  const missingCount = rows.filter(r => !r.report_number && !r.report_not_required).length
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

  // Download the currently-shown rows (current filters + sort + month/year) as CSV.
  function exportCsv() {
    const headers = ['Report #', 'Type', 'Stage', 'Cargo type', 'Vessel', 'Job name', 'Client', 'Surveyors', 'Status', 'Start date', 'End date', 'Regular hours', 'Overtime hours', 'Billing mode', 'Distance (km)', 'Invoice #', 'Invoice status', 'Invoice total', 'Currency', 'Notes']
    const lines = [headers.join(',')]
    for (const r of visible) {
      lines.push([
        csv(r.report_not_required ? 'N/A' : r.report_number), csv(r.job_type), csv(r.job_stage), csv(r.cargo_type), csv(r.vessel_name), csv(r.title),
        csv(r.client_name), csv(r.surveyors.join('; ')),
        csv(WORKFLOW[r.workflow_status as keyof typeof WORKFLOW]?.label ?? r.workflow_status),
        csv(formatDate(r.scheduled_date ?? r.created_at)), csv(r.end_date ? formatDate(r.end_date) : ''),
        csv(r.regular_hours || ''), csv(r.overtime_hours || ''), csv(r.billing_mode ?? ''), csv(r.total_km || ''),
        csv(r.invoice_number), csv(r.invoice_status), csv(r.invoice_total ?? ''), csv(r.invoice_currency),
        csv(r.notes),
      ].join(','))
    }
    // BOM + CRLF so Excel opens the UTF-8 cleanly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const d = new Date()
    a.href = url
    a.download = `jobs-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.csv`
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-5 animate-rise">
      <datalist id="jobTypeOptions">{typeOptions.map(t => <option key={t} value={t} />)}</datalist>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="text-gray-500 mt-1 text-sm">{loading ? '…' : `${visible.length} job${visible.length !== 1 ? 's' : ''}`}{missingCount > 0 && !loading ? ` · ${missingCount} missing report #` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {missingCount > 0 && (
            <button onClick={() => setNumberOpen(true)} className="btn-secondary"><Hash className="h-4 w-4" /><span className="hidden sm:inline">Number reports</span></button>
          )}
          <button onClick={exportCsv} disabled={loading || visible.length === 0} className="btn-secondary" title="Download the shown jobs as a CSV (respects filters)">
            <Download className="h-4 w-4" /><span className="hidden sm:inline">Export CSV</span>
          </button>
          <ColumnsMenu narrow={narrow} colVisible={colVisible} onToggle={toggleCol} onReset={resetCols} onEqual={equalizeColumns} onAutofitAll={autofitAll} />
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

      {/* Colour-by + month/year filter */}
      <JobsViewToolbar view={view} years={jobYears} count={visible.length} legend={legend} />

      {/* Grid — fills exactly one page (fixed layout, weighted column widths that
          sum to 100%). Headers drag to reorder; their right edge drags to resize /
          double-clicks to auto-fit. Faint gridlines between columns. */}
      <div className="card overflow-hidden">
        <div ref={scrollRef} className={`${narrow ? 'overflow-x-auto' : 'overflow-x-hidden'} overflow-y-auto max-h-[calc(100vh-15rem)]`}>
          <table ref={tableRef} className={`${narrow ? '' : 'w-full'} text-sm`} style={{ tableLayout: 'fixed', width: narrow ? narrowTableWidth : availWidth || undefined }}>
            <colgroup>
              <col style={{ width: 36 }} />
              {visibleColumns.map(c => <col key={c.key} style={{ width: colWidthStyle(c.key) }} />)}
            </colgroup>
            <thead>
              <DndContext sensors={colSensors} collisionDetection={closestCenter} onDragEnd={handleColDragEnd}>
                <tr>
                  <th className="sticky top-0 z-10 bg-gray-50 border-b border-r border-gray-200/80 px-2 py-2.5" />
                  <SortableContext items={visibleColumns.map(c => c.key)} strategy={horizontalListSortingStrategy}>
                    {visibleColumns.map((c, i) => (
                      <SortableHeaderCell key={c.key} col={c} sort={sort} onSort={handleSort} onResize={startResize} onAutofit={autofitColumn} isLast={i === visibleColumns.length - 1} />
                    ))}
                  </SortableContext>
                </tr>
              </DndContext>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                [0, 1, 2, 3, 4, 5].map(i => (
                  <tr key={i}>
                    <td className="px-2 py-2.5" />
                    {visibleColumns.map(c => <td key={c.key} className="px-3 py-2.5"><div className="skeleton h-3.5 w-16" /></td>)}
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr><td colSpan={visibleColumns.length + 1} className="px-4 py-12 text-center text-gray-400">{q || filter !== 'all' ? 'No jobs match.' : <>No jobs yet. <Link href="/admin/jobs/new" className="text-brand-600 hover:underline">Create one →</Link></>}</td></tr>
              ) : paged.map(r => {
                const c = rowColor(view.colorMode, r.client_color, r.template_color)
                return (
                <tr key={r.id} className="hover:bg-gray-50/70 transition-colors duration-100 align-middle" style={c ? { backgroundColor: c.bg } : undefined}>
                  <td className="px-2 py-1.5 border-r border-gray-100" style={{ borderLeft: `4px solid ${c ? c.fg : 'transparent'}` }}>
                    <Link href={`/admin/jobs/${r.id}`} title="Open job" aria-label="Open job" className="inline-flex p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-brand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"><ExternalLink className="h-4 w-4" /></Link>
                  </td>
                  {visibleColumns.map((col, i) => (
                    <td key={col.key} data-col={col.key} className={`py-1.5 overflow-hidden align-middle ${i === visibleColumns.length - 1 ? '' : 'border-r border-gray-100'}`}><JobCell col={col} row={r} ctx={cellCtx} /></td>
                  ))}
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {!loading && visible.length > shown && (
        <div className="flex justify-center">
          <button onClick={() => setShown(s => s + PAGE_SIZE)} className="btn-secondary">
            Show more <span className="text-gray-400">({visible.length - shown} more)</span>
          </button>
        </div>
      )}

      <NumberReportsModal open={numberOpen} onClose={() => setNumberOpen(false)} rows={rows} onDone={load} />
    </div>
  )
}

function NumberReportsModal({ open, onClose, rows, onDone }: { open: boolean; onClose: () => void; rows: TrackerRow[]; onDone: () => void }) {
  const missing = rows.filter(r => !r.report_number && !r.report_not_required)
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
