'use client'

// Admin invoicing hub: the invoices ledger, reconciliation, and the invoicing
// defaults (tax + overdue window, numbering, bank accounts). Invoices are created
// on each job; this page is the cross-job view + settings. Per-client billing
// rates moved to the Clients hub (Clients → Rates).

import { useEffect, useState, Fragment } from 'react'
import Link from 'next/link'
import { Receipt, Plus, X, Loader2, Save, AlertTriangle, ChevronRight, Briefcase, Clock, Search } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { cn, formatDate } from '@/lib/utils'
import { CURRENCIES, money, WORKFLOW } from '@/lib/jobs/tracker'
import {
  listInvoices, isOverdue,
  getAppSettings, updateAppSettings, logInvoiceReminder, getInvoiceCounter, setInvoiceNextNumber,
  listBankAccounts, saveBankAccount, deleteBankAccount, clientsPayingInto,
  type InvoiceListRow, type InvoiceCounter,
} from '@/lib/jobs/invoicing'
import { listReconciliation, snoozeReconciliation, RECON_META, RECON_ORDER, RECON_SNOOZE_DAYS, type ReconItem, type ReconCategory } from '@/lib/jobs/reconciliation'
import { getInvoicingDashboard, metricsLabour, metricsLabourByJob, type InvoicingDashboard, type SurveyorLabour, type SurveyorJobLabour } from '@/lib/jobs/dashboard'
import InvoicesTable from '@/components/invoicing/InvoicesTable'
import ConsolidatedInvoiceBuilder from '@/components/invoicing/ConsolidatedInvoiceBuilder'
import InvoiceEditModal from '@/components/invoicing/InvoiceEditModal'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import type { Currency, AppSettings, Invoice, BankAccount } from '@/lib/types/database'

type Tab = 'overview' | 'create' | 'invoices' | 'reconcile' | 'settings'
type StatusFilter = 'open' | Invoice['status'] | 'all'

export default function AdminInvoicingPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [flagCount, setFlagCount] = useState<number | null>(null)

  // Fetch the badge count once on mount (not on every tab click). The Reconcile
  // tab reports its fresh count back via onCount so the badge stays accurate after
  // any reconcile action, without this view re-fetching the whole set repeatedly.
  useEffect(() => { listReconciliation().then(r => setFlagCount(r.items.length)) }, [])

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-rise">
      <PageHeader icon={Receipt} title="Finance" subtitle="Invoices, reconciliation and billing defaults." />

      <Tabs
        active={tab}
        onChange={k => setTab(k as Tab)}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'create', label: 'Create invoice' },
          { key: 'invoices', label: 'Invoices' },
          { key: 'reconcile', label: 'Reconcile', badge: flagCount ?? undefined },
          { key: 'settings', label: 'Settings' },
        ]}
      />

      {tab === 'overview' && <OverviewTab />}
      {tab === 'create' && <ConsolidatedInvoiceBuilder onCreated={() => listReconciliation().then(r => setFlagCount(r.items.length))} />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'reconcile' && <ReconcileTab onCount={setFlagCount} />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ── Overview: cross-ledger dashboard ─────────────────────────────────────────
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

function OverviewTab() {
  const [data, setData] = useState<InvoicingDashboard | null>(null)
  useEffect(() => { getInvoicingDashboard().then(setData) }, [])

  // Labour window — we pay monthly, so it opens on the current month; switch to a
  // whole year or all time. Jobs count in the month they're scheduled.
  const [labourMode, setLabourMode] = useState<'month' | 'year' | 'all'>('month')
  const [labourMonth, setLabourMonth] = useState(thisMonth) // YYYY-MM
  const [labourYear, setLabourYear] = useState(String(new Date().getFullYear()))
  const [labour, setLabour] = useState<SurveyorLabour[] | null>(null)
  // Per-job breakdown behind each surveyor row (same window, day-worked rule).
  const [labourJobs, setLabourJobs] = useState<Map<string, SurveyorJobLabour[]>>(new Map())
  const [openSurveyor, setOpenSurveyor] = useState<string | null>(null)
  useEffect(() => {
    let from: string | null = null, to: string | null = null
    if (labourMode === 'month' && labourMonth) {
      const [y, m] = labourMonth.split('-').map(Number)
      from = `${labourMonth}-01`
      to = `${labourMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    } else if (labourMode === 'year') {
      from = `${labourYear}-01-01`; to = `${labourYear}-12-31`
    }
    let active = true
    setLabour(null); setOpenSurveyor(null)
    metricsLabour(from, to).then(l => { if (active) setLabour(l) })
    metricsLabourByJob(from, to).then(m => { if (active) setLabourJobs(m) })
    return () => { active = false }
  }, [labourMode, labourMonth, labourYear])
  const yearOptions = Array.from({ length: new Date().getFullYear() - 2024 + 1 }, (_, i) => String(2024 + i)).reverse()

  if (!data) return <div className="space-y-3">{[0, 1].map(i => <div key={i} className="skeleton h-28 w-full" />)}</div>

  const hasBilling = data.billing.length > 0
  const maxJob = Math.max(1, ...data.jobsByWorkflow.map(j => j.count))

  return (
    <div className="space-y-6">
      {/* Billing — outstanding / overdue / paid, per currency */}
      <section>
        <h2 className="section-title mb-3">Billing</h2>
        {!hasBilling ? (
          <div className="card p-8 text-center text-sm text-gray-400">No invoices yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.billing.map(b => (
              <div key={b.currency} className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold tracking-wide text-gray-400">{b.currency}</span>
                  <span className="text-[11px] text-gray-400">{b.count} invoice{b.count === 1 ? '' : 's'}</span>
                </div>
                <p className="text-2xl font-semibold text-gray-900 tnum">{money(b.outstanding, b.currency)}</p>
                <p className="text-xs text-gray-400 mb-3">outstanding</p>
                <div className="space-y-1 text-sm border-t border-gray-100 pt-3">
                  {b.overdue > 0 && <div className="flex justify-between"><span className="text-red-600">Overdue</span><span className="tnum text-red-600 font-medium">{money(b.overdue, b.currency)}</span></div>}
                  <div className="flex justify-between text-gray-500"><span>Paid</span><span className="tnum">{money(b.paid, b.currency)}</span></div>
                  {b.draft > 0 && <div className="flex justify-between text-gray-400"><span>Draft</span><span className="tnum">{money(b.draft, b.currency)}</span></div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Jobs pipeline */}
      <section>
        <h2 className="section-title mb-3 flex items-center gap-2"><Briefcase className="h-4 w-4 text-gray-400" /> Jobs pipeline <span className="text-xs font-normal text-gray-400">· {data.openJobs} open</span></h2>
        <div className="card p-5 space-y-2">
          {data.jobsByWorkflow.filter(j => j.count > 0).map(j => {
            const meta = WORKFLOW[j.status]
            return (
              <div key={j.status} className="flex items-center gap-3">
                <div className="w-32 flex items-center gap-1.5 shrink-0">
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  <span className="text-sm text-gray-700">{meta.label}</span>
                </div>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full ${meta.dot}`} style={{ width: `${(j.count / maxJob) * 100}%` }} />
                </div>
                <span className="w-8 text-right text-sm tnum text-gray-600">{j.count}</span>
              </div>
            )
          })}
          {data.jobsByWorkflow.every(j => j.count === 0) && <p className="text-sm text-gray-400">No jobs yet.</p>}
        </div>
      </section>

      {/* Labour — hours, overtime & distance per surveyor (for pay), windowed */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="section-title flex items-center gap-2"><Clock className="h-4 w-4 text-gray-400" /> Labour &amp; overtime</h2>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-0.5 text-xs font-medium" role="group" aria-label="Labour period">
              {([['month', 'Month'], ['year', 'Year'], ['all', 'All time']] as const).map(([mode, label]) => (
                <button key={mode} onClick={() => setLabourMode(mode)}
                  className={`px-2.5 py-1 rounded-full transition-colors ${labourMode === mode ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>
            {labourMode === 'month' && <input type="month" value={labourMonth} onChange={e => setLabourMonth(e.target.value || thisMonth())} className="input-base text-xs py-1 w-36" aria-label="Month" />}
            {labourMode === 'year' && (
              <select value={labourYear} onChange={e => setLabourYear(e.target.value)} className="input-base text-xs py-1 w-24" aria-label="Year">
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
        </div>
        {labour === null ? (
          <div className="skeleton h-28 w-full" />
        ) : labour.length === 0 ? (
          <div className="card p-8 text-center text-sm text-gray-400">
            {labourMode === 'all' ? 'No hours logged yet.' : 'Nothing logged in this period.'}
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                  <th className="font-medium px-4 py-2.5">Surveyor</th>
                  <th className="font-medium px-4 py-2.5 text-right">Regular hrs</th>
                  <th className="font-medium px-4 py-2.5 text-right">Overtime hrs</th>
                  <th className="font-medium px-4 py-2.5 text-right">Distance (km)</th>
                  <th className="font-medium px-4 py-2.5 text-right">Pay</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {labour.map(s => {
                  const jobs = labourJobs.get(s.surveyor_id) ?? []
                  const isOpen = openSurveyor === s.surveyor_id
                  return (
                  <Fragment key={s.surveyor_id}>
                    <tr onClick={() => setOpenSurveyor(isOpen ? null : s.surveyor_id)}
                      className={`border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/60 ${isOpen ? 'bg-gray-50/60' : ''}`}>
                      <td className="px-4 py-3 text-gray-900">{s.name}</td>
                      <td className="px-4 py-3 text-right tnum text-gray-600">{s.regular_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                      <td className="px-4 py-3 text-right tnum text-gray-900 font-medium">{s.overtime_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                      <td className="px-4 py-3 text-right tnum text-gray-600">{s.km ? s.km.toLocaleString() : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-right">
                        {s.pay.length === 0 ? <span className="text-gray-300">—</span> : (
                          <div className="flex flex-col items-end gap-0.5">
                            {s.pay.map(p => <span key={p.currency} className="tnum text-gray-700">{money(p.total, p.currency)}</span>)}
                          </div>
                        )}
                      </td>
                      <td className="px-2 text-gray-300"><ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} /></td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/40 border-b border-gray-100">
                        <td colSpan={6} className="px-4 py-3">
                          {jobs.length === 0 ? (
                            <p className="text-xs text-gray-400">No per-job detail for this period.</p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-left text-gray-400">
                                    <th className="font-medium px-3 py-1.5">Date</th>
                                    <th className="font-medium px-3 py-1.5">Job</th>
                                    <th className="font-medium px-3 py-1.5 text-right">Reg hrs</th>
                                    <th className="font-medium px-3 py-1.5 text-right">OT hrs</th>
                                    <th className="font-medium px-3 py-1.5 text-right">Km</th>
                                    <th className="font-medium px-3 py-1.5 text-right">Pay</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {jobs.map(j => (
                                    <tr key={j.job_id} className="border-t border-gray-100">
                                      <td className="px-3 py-1.5 text-gray-500 tnum whitespace-nowrap">{j.job_date ? formatDate(j.job_date) : '—'}</td>
                                      <td className="px-3 py-1.5">
                                        <Link href={`/admin/jobs/${j.job_id}`} onClick={e => e.stopPropagation()} className="text-brand-700 hover:underline">
                                          {j.vessel_name ? `M.V. ${j.vessel_name}` : (j.job_title || 'Job')}
                                        </Link>
                                        {j.report_number && <span className="text-gray-400 tnum"> · {j.report_number}</span>}
                                      </td>
                                      <td className="px-3 py-1.5 text-right tnum text-gray-600">{j.regular_hours ? j.regular_hours.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
                                      <td className="px-3 py-1.5 text-right tnum text-gray-900 font-medium">{j.overtime_hours ? j.overtime_hours.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</td>
                                      <td className="px-3 py-1.5 text-right tnum text-gray-600">{j.km ? j.km.toLocaleString() : '—'}</td>
                                      <td className="px-3 py-1.5 text-right">
                                        {j.pay.length === 0 ? <span className="text-gray-300">—</span> : (
                                          <div className="flex flex-col items-end gap-0.5">
                                            {j.pay.map(p => <span key={p.currency} className="tnum text-gray-700">{money(p.total, p.currency)}</span>)}
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
            </div>
            <p className="px-4 py-2 border-t border-gray-50 text-[11px] text-gray-400">Overtime shifts and km trips count on the day they were worked or driven. Regular hours (and typed-in OT with no shift log) count in the month the job is scheduled. Tap a surveyor to see the jobs behind their totals.</p>
          </div>
        )}
      </section>

      {/* Outstanding by client */}
      {data.clients.length > 0 && (
        <section>
          <h2 className="section-title mb-3">Outstanding by client</h2>
          <div className="card divide-y divide-gray-50">
            {data.clients.slice(0, 8).map(c => (
              <div key={c.client_id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm text-gray-900 truncate">{c.name}</span>
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  {c.amounts.map(a => <span key={a.currency} className="tnum text-sm text-gray-700">{money(a.amount, a.currency)}</span>)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ── Invoices ledger ──────────────────────────────────────────────────────────
const INVOICES_PAGE = 50
function InvoicesTab() {
  const [rows, setRows] = useState<InvoiceListRow[] | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('open')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(INVOICES_PAGE)
  const [editId, setEditId] = useState<string | null>(null)

  const load = () => listInvoices().then(setRows)
  useEffect(() => { load() }, [])

  const term = q.trim().toLowerCase()
  const filtered = (rows ?? []).filter(r => {
    const statusPass = filter === 'all' ? true
      : filter === 'open' ? (r.status !== 'paid' && r.status !== 'void')
      : filter === 'overdue' ? isOverdue(r)
      : r.status === filter
    if (!statusPass) return false
    if (!term) return true
    return [r.invoice_number, r.client_name, r.vessel_name, r.report_number]
      .some(v => (v ?? '').toLowerCase().includes(term))
  })

  // Reset the page window when the filter or search changes.
  useEffect(() => { setShown(INVOICES_PAGE) }, [filter, q])
  const paged = filtered.slice(0, shown)

  const filters: [StatusFilter, string][] = [['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['all', 'All']]

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search invoice #, client, vessel or report…" className="input-base pl-9" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters.map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
              filter === k ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
            {label}
          </button>
        ))}
      </div>
      {rows === null ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14 w-full" />)}</div>
      ) : (
        <>
          <InvoicesTable rows={paged} manage onChanged={load} onEdit={r => setEditId(r.id)} hrefFor={r => r.job_id ? `/admin/jobs/${r.job_id}` : null} />
          {filtered.length > shown && (
            <div className="text-center pt-1">
              <button onClick={() => setShown(s => s + INVOICES_PAGE)} className="btn-secondary">
                Show more ({filtered.length - shown} more)
              </button>
            </div>
          )}
        </>
      )}
      {editId && <InvoiceEditModal invoiceId={editId} onClose={() => setEditId(null)} onSaved={() => { setEditId(null); load() }} />}
    </div>
  )
}

// ── Reconciliation: work done but billing not closed out ─────────────────────
function ReconcileTab({ onCount }: { onCount?: (n: number) => void }) {
  const [items, setItems] = useState<ReconItem[] | null>(null)
  const [counts, setCounts] = useState<Record<ReconCategory, number> | null>(null)

  const load = () => listReconciliation().then(r => { setItems(r.items); setCounts(r.counts); onCount?.(r.items.length) })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function clearAll() {
    if (!items || items.length === 0) return
    if (!(await confirmDialog({ title: 'Clear all flags?', message: `Hide all ${items.length} reconciliation item${items.length === 1 ? '' : 's'} for ${RECON_SNOOZE_DAYS} days. The jobs aren't deleted — flags re-check automatically later.`, confirmLabel: 'Clear all' }))) return
    const res = await snoozeReconciliation(items.map(i => i.job_id))
    if (res.error) { toast.error(res.error); return }
    toast.success('All cleared'); load()
  }

  if (items === null) return <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16 w-full" />)}</div>

  if (items.length === 0) {
    return (
      <div className="card p-10 text-center space-y-2">
        <div className="w-12 h-12 rounded-2xl bg-green-100 flex items-center justify-center mx-auto"><Receipt className="h-6 w-6 text-green-600" /></div>
        <p className="text-sm font-medium text-gray-700">Nothing to reconcile</p>
        <p className="text-sm text-gray-500">Every job with completed work has been invoiced or closed.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          {items.length} job{items.length === 1 ? '' : 's'} need attention so billing isn&apos;t forgotten.
        </p>
        <button onClick={clearAll} className="btn-ghost py-1 px-2.5 text-xs text-gray-500 hover:text-gray-800 shrink-0"><X className="h-3.5 w-3.5" /> Clear all</button>
      </div>
      {RECON_ORDER.filter(c => (counts?.[c] ?? 0) > 0).map(cat => {
        const meta = RECON_META[cat]
        const group = items.filter(i => i.category === cat)
        return (
          <div key={cat} className="card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
              <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
              <span className="text-sm font-medium text-gray-800">{meta.label}</span>
              <span className="text-xs text-gray-400">· {meta.blurb}</span>
              <span className="ml-auto text-xs text-gray-400 tnum">{group.length}</span>
            </div>
            <div className="divide-y divide-gray-50">
              {group.map(i => cat === 'overdue_invoice'
                ? <OverdueRow key={i.job_id} item={i} onReminded={load} onCleared={load} />
                : (
                  <div key={i.job_id} className="flex items-center gap-1 px-2 py-1 hover:bg-gray-50/60 transition-colors">
                    <Link href={`/admin/jobs/${i.job_id}`} className="flex items-center gap-3 px-2 py-2 min-w-0 flex-1">
                      <span className="tnum text-sm font-medium text-gray-900 w-24 shrink-0">{i.report_number ?? '—'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-900 truncate">{i.client_name ?? 'No client'}</p>
                        {i.vessel_name && <p className="text-xs text-gray-400 truncate">M.V. {i.vessel_name}</p>}
                      </div>
                      {i.invoice_total != null && <span className="tnum text-sm text-gray-600">{money(i.invoice_total, i.currency ?? 'USD')}</span>}
                      <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                    </Link>
                    <ClearReconButton jobId={i.job_id} onCleared={load} />
                  </div>
                ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ClearReconButton({ jobId, onCleared }: { jobId: string; onCleared: () => void }) {
  const [busy, setBusy] = useState(false)
  async function clear() {
    setBusy(true)
    const res = await snoozeReconciliation(jobId)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Cleared'); onCleared()
  }
  return (
    <button onClick={clear} disabled={busy} title={`Hide for now — re-checks in ${RECON_SNOOZE_DAYS} days`}
      className="btn-ghost py-1 px-2 text-xs text-gray-400 hover:text-gray-700 shrink-0">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Clear
    </button>
  )
}

function daysOverdue(due: string | null): number {
  if (!due) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(`${due}T00:00:00`)
  return Math.max(0, Math.round((today.getTime() - d.getTime()) / 86_400_000))
}

function OverdueRow({ item, onReminded, onCleared }: { item: ReconItem; onReminded: () => void; onCleared: () => void }) {
  const [busy, setBusy] = useState(false)
  const days = daysOverdue(item.due_date)

  async function remind() {
    if (!item.invoice_id) return
    setBusy(true)
    const res = await logInvoiceReminder(item.invoice_id)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Reminder logged'); onReminded()
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Link href={`/admin/jobs/${item.job_id}`} className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80 transition-opacity">
        <span className="tnum text-sm font-medium text-gray-900 w-24 shrink-0">{item.report_number ?? '—'}</span>
        <div className="min-w-0">
          <p className="text-sm text-gray-900 truncate">{item.client_name ?? 'No client'}</p>
          <p className="text-xs text-gray-400">
            <span className="text-red-600 font-medium">{days} day{days === 1 ? '' : 's'} overdue</span>
            {' · '}{item.last_reminded_at ? `reminded ${formatDate(item.last_reminded_at)}` : 'not chased yet'}
          </p>
        </div>
      </Link>
      {item.invoice_total != null && <span className="tnum text-sm text-gray-600 shrink-0">{money(item.invoice_total, item.currency ?? 'USD')}</span>}
      <button onClick={remind} disabled={busy} className="btn-secondary py-1 px-2.5 text-xs shrink-0">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />} Log reminder
      </button>
      <ClearReconButton jobId={item.job_id} onCleared={onCleared} />
    </div>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────
function SettingsTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [taxName, setTaxName] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [overdue, setOverdue] = useState('')
  const [kmRate, setKmRate] = useState('')
  const [kmCurrency, setKmCurrency] = useState<Currency>('TTD')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getAppSettings().then(s => {
      setSettings(s)
      if (s) {
        setTaxName(s.default_tax_name); setTaxRate(String(s.default_tax_rate)); setOverdue(String(s.overdue_days))
        setKmRate(String(s.surveyor_km_rate ?? 0)); setKmCurrency(s.surveyor_km_currency ?? 'TTD')
      }
    })
  }, [])

  async function save() {
    setSaving(true)
    const res = await updateAppSettings({
      default_tax_name: taxName, default_tax_rate: Number(taxRate) || 0, overdue_days: Number(overdue) || 0,
      surveyor_km_rate: Number(kmRate) || 0, surveyor_km_currency: kmCurrency,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Settings saved')
  }

  if (!settings) return <div className="skeleton h-32 w-full max-w-md" />

  return (
    // Two columns on desktop (bank accounts get their own side — they're the
    // longest card); stacked single-column on mobile.
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <div className="space-y-6">
      <InvoiceNumberingCard />
      <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-medium text-gray-900">Billing defaults</h3>
        <p className="text-xs text-gray-400">Pre-filled when a new invoice is created.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label-base">Default tax name</label>
          <input value={taxName} onChange={e => setTaxName(e.target.value)} className="input-base" />
        </div>
        <div>
          <label className="label-base">Default tax rate (%)</label>
          <input type="number" min={0} step="0.01" value={taxRate} onChange={e => setTaxRate(e.target.value)} className="input-base" />
        </div>
      </div>
      <div>
        <label className="label-base">Overdue after (days)</label>
        <input type="number" min={0} value={overdue} onChange={e => setOverdue(e.target.value)} className="input-base" />
        <p className="text-[11px] text-gray-400 mt-1">A sent invoice is flagged overdue this many days past its due date.</p>
      </div>
      <div className="pt-4 border-t border-gray-100">
        <h3 className="font-medium text-gray-900">Surveyor travel pay</h3>
        <p className="text-xs text-gray-400 mb-3">What you pay surveyors per kilometre driven. Applies to every job; the total shows in the <strong>Pay</strong> column of the Labour table above.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-base">Rate per km</label>
            <input type="number" min={0} step="0.01" value={kmRate} onChange={e => setKmRate(e.target.value)} className="input-base" placeholder="0.00" />
          </div>
          <div>
            <label className="label-base">Currency</label>
            <select value={kmCurrency} onChange={e => setKmCurrency(e.target.value as Currency)} className="input-base">
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Set the rate to 0 to pay no travel. Distance is logged per surveyor on each job.</p>
      </div>
      <button onClick={save} disabled={saving} className="btn-primary py-2 px-4 text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save settings</button>
      </div>
      </div>
      <BankAccountsCard />
    </div>
  )
}

// ── Bank accounts (selectable on invoices) ───────────────────────────────────
function BankAccountsCard() {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null)
  const [editing, setEditing] = useState<BankAccount | 'new' | null>(null)

  const load = () => listBankAccounts().then(setAccounts)
  useEffect(() => { load() }, [])

  async function remove(a: BankAccount) {
    // Surface which clients "pay into" this account — deleting severs those links
    // (they fall back to the default on future invoices).
    const linked = await clientsPayingInto(a.id)
    const linkedMsg = linked.length
      ? ` ${linked.length === 1 ? `${linked[0]} is` : `${linked.length} clients (${linked.join(', ')}) are`} linked to pay into this account — they'll fall back to the default account on future invoices.`
      : ''
    if (!(await confirmDialog({ title: 'Delete bank account?', message: `Remove "${a.label}"?${linkedMsg} Invoices already issued keep the details they were printed with.`, confirmLabel: 'Delete', danger: true }))) return
    const res = await deleteBankAccount(a.id)
    if (res.error) { toast.error(res.error); return }
    toast.success('Bank account deleted'); load()
  }

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h3 className="font-medium text-gray-900">Bank accounts</h3>
        <p className="text-xs text-gray-400">Pick one of these when creating an invoice. Add several (e.g. a USD and a TTD account) and mark one as the default.</p>
      </div>
      {accounts === null ? <div className="skeleton h-16 w-full" /> : (
        <div className="divide-y divide-gray-100">
          {accounts.length === 0 && editing !== 'new' && <p className="py-2 text-sm text-gray-400">No bank accounts yet.</p>}
          {accounts.map(a => editing && editing !== 'new' && editing.id === a.id
            ? <div key={a.id} className="py-2"><BankAccountEditor existing={a} onDone={() => { setEditing(null); load() }} /></div>
            : (
              <div key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5 flex-wrap">
                    {a.label}
                    {a.currency && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 tnum">{a.currency}</span>}
                    {a.is_default && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-brand-100 text-brand-700">Default</span>}
                    {!a.is_active && <span className="text-[10px] text-gray-400">inactive</span>}
                  </p>
                  <p className="text-xs text-gray-500 whitespace-pre-wrap line-clamp-2 mt-0.5">{a.details}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditing(a)} className="text-xs text-brand-600 hover:text-brand-800 font-medium px-2">Edit</button>
                  <button onClick={() => remove(a)} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            ))}
          {editing === 'new' && <div className="py-2"><BankAccountEditor onDone={() => { setEditing(null); load() }} /></div>}
        </div>
      )}
      {editing !== 'new' && (
        <button onClick={() => setEditing('new')} className="btn-secondary py-1.5 px-3 text-sm"><Plus className="h-4 w-4" /> Add bank account</button>
      )}
    </div>
  )
}

function BankAccountEditor({ existing, onDone }: { existing?: BankAccount; onDone: () => void }) {
  const [label, setLabel] = useState(existing?.label ?? '')
  const [currency, setCurrency] = useState<string>(existing?.currency ?? '')
  const [details, setDetails] = useState(existing?.details ?? '')
  const [isDefault, setIsDefault] = useState(existing?.is_default ?? false)
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!label.trim()) { toast.error('Give the account a label'); return }
    if (!details.trim()) { toast.error('Add the bank details'); return }
    setSaving(true)
    const res = await saveBankAccount({ id: existing?.id, label: label.trim(), currency: (currency || null) as Currency | null, details: details.trim(), is_default: isDefault })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(existing ? 'Bank account updated' : 'Bank account added'); onDone()
  }

  const cell = 'input-base py-1.5 text-sm'
  return (
    <div className="bg-gray-50/60 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-gray-400">Label</label>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. RBC USD account" className={cell} />
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Currency (optional)</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className={cell}>
            <option value="">Any</option>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="text-[11px] text-gray-400">Bank details (shown on the invoice)</label>
        <textarea value={details} onChange={e => setDetails(e.target.value)} rows={4} placeholder={'Bank name, branch, SWIFT/BIC, account name + number…'} className="input-base text-sm resize-y" />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} /> Default account
      </label>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary py-1.5 px-3 text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
        <button onClick={onDone} className="btn-secondary py-1.5 px-3 text-sm">Cancel</button>
      </div>
    </div>
  )
}

// ── Invoice numbering (admin) ────────────────────────────────────────────────
function InvoiceNumberingCard() {
  const [counter, setCounter] = useState<InvoiceCounter | null>(null)
  const [loading, setLoading] = useState(true)
  const [nextVal, setNextVal] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => getInvoiceCounter().then(c => { setCounter(c); setLoading(false) })
  useEffect(() => { load() }, [])

  async function save() {
    const n = parseInt(nextVal, 10)
    if (!Number.isFinite(n) || n < 1) { toast.error('Enter the next number (1 or higher)'); return }
    if (counter && n <= counter.last_seq && !(await confirmDialog({ title: 'Reuse an earlier number?', message: `The next number (#${n}) is at or below the last used (#${counter.last_seq}). This can create duplicate invoice numbers. Continue?`, confirmLabel: 'Set anyway', danger: true }))) return
    setSaving(true)
    const res = await setInvoiceNextNumber(n)
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Invoice numbering updated'); setNextVal(''); load()
  }

  if (loading) return <div className="card p-5"><div className="skeleton h-5 w-40 mb-3" /><div className="skeleton h-16 w-full" /></div>
  if (!counter) return null

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h3 className="font-medium text-gray-900">Invoice numbering</h3>
        <p className="text-xs text-gray-400">Auto-numbered <span className="tnum">YY-MM-NNN</span> (e.g. <span className="tnum">26-06-001</span>) — same format as report numbers; the sequence resets to <span className="tnum">001</span> each fiscal year (1 February). Leave the number blank on a new invoice to auto-assign.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-[11px] text-gray-400">Next invoice will be</p>
          <p className="tnum font-semibold text-gray-900 mt-0.5">{counter.next_number}</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="text-[11px] text-gray-400">Last used · FY {counter.fiscal_year}</p>
          <p className="tnum text-gray-700 mt-0.5">{counter.last_seq > 0 ? `#${counter.last_seq}` : 'none yet'}</p>
        </div>
      </div>
      <div>
        <label className="label-base">Set the next number</label>
        <div className="flex items-center gap-2">
          <input type="number" min={1} value={nextVal} onChange={e => setNextVal(e.target.value)} placeholder={String(counter.last_seq + 1)} className="input-base py-1.5 text-sm w-32 tnum" />
          <button onClick={save} disabled={saving || !nextVal} className="btn-primary py-1.5 px-3 text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">e.g. enter <span className="tnum">100</span> and the next invoice becomes <span className="tnum">{counter.next_number.slice(0, 6)}100</span>, continuing from there. Set to <span className="tnum">1</span> to start the year&apos;s run at <span className="tnum">001</span>. Keep numbers unique.</p>
      </div>
    </div>
  )
}
