'use client'

// Admin invoicing hub: the invoices ledger, per-client billing rates, and the
// invoicing defaults (tax + overdue window). Invoices are created on each job;
// this page is the cross-job view + the rate/settings configuration.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Receipt, Plus, X, Loader2, Save, AlertTriangle, ChevronRight, Briefcase, Clock, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { cn, formatDate } from '@/lib/utils'
import { CURRENCIES, money, listJobTypes, WORKFLOW } from '@/lib/jobs/tracker'
import {
  listInvoices, isOverdue, listClientRates, addClientRate, updateClientRate, deleteClientRate,
  getAppSettings, updateAppSettings, logInvoiceReminder, getInvoiceCounter, setInvoiceNextNumber,
  listBankAccounts, saveBankAccount, deleteBankAccount,
  type InvoiceListRow, type InvoiceCounter,
} from '@/lib/jobs/invoicing'
import { listReconciliation, snoozeReconciliation, RECON_META, RECON_ORDER, RECON_SNOOZE_DAYS, type ReconItem, type ReconCategory } from '@/lib/jobs/reconciliation'
import { getInvoicingDashboard, type InvoicingDashboard } from '@/lib/jobs/dashboard'
import InvoicesTable from '@/components/invoicing/InvoicesTable'
import ConsolidatedInvoiceBuilder from '@/components/invoicing/ConsolidatedInvoiceBuilder'
import type { Client, ClientRate, Currency, AppSettings, Invoice, BankAccount } from '@/lib/types/database'

type Tab = 'overview' | 'create' | 'invoices' | 'reconcile' | 'rates' | 'settings'
type StatusFilter = 'open' | Invoice['status'] | 'all'

export default function AdminInvoicingPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [flagCount, setFlagCount] = useState<number | null>(null)

  // Fetch the badge count once on mount (not on every tab click). The Reconcile
  // tab reports its fresh count back via onCount so the badge stays accurate after
  // any reconcile action, without this view re-fetching the whole set repeatedly.
  useEffect(() => { listReconciliation().then(r => setFlagCount(r.items.length)) }, [])

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-rise">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center"><Receipt className="h-5 w-5 text-brand-600" /></div>
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Invoices, client rates and billing defaults.</p>
        </div>
      </div>

      <div className="flex gap-0.5 border-b border-gray-200 overflow-x-auto">
        {([['overview', 'Overview'], ['create', 'Create invoice'], ['invoices', 'Invoices'], ['reconcile', 'Reconcile'], ['rates', 'Client rates'], ['settings', 'Settings']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('px-3.5 py-2 text-sm font-medium border-b-2 -mb-px rounded-t-md transition-colors flex items-center gap-1.5 whitespace-nowrap',
              tab === k ? 'border-brand-600 text-brand-700 bg-brand-50/60' : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50')}>
            {label}
            {k === 'reconcile' && flagCount != null && flagCount > 0 && (
              <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-amber-500 text-white text-[11px] font-semibold tnum">{flagCount}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'create' && <ConsolidatedInvoiceBuilder onCreated={() => listReconciliation().then(r => setFlagCount(r.items.length))} />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'reconcile' && <ReconcileTab onCount={setFlagCount} />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ── Overview: cross-ledger dashboard ─────────────────────────────────────────
function OverviewTab() {
  const [data, setData] = useState<InvoicingDashboard | null>(null)
  useEffect(() => { getInvoicingDashboard().then(setData) }, [])

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

      {/* Labour — hours & overtime per surveyor (for pay) */}
      <section>
        <h2 className="section-title mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-gray-400" /> Labour &amp; overtime</h2>
        {data.labour.length === 0 ? (
          <div className="card p-8 text-center text-sm text-gray-400">No hours logged yet.</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                  <th className="font-medium px-4 py-2.5">Surveyor</th>
                  <th className="font-medium px-4 py-2.5 text-right">Regular hrs</th>
                  <th className="font-medium px-4 py-2.5 text-right">Overtime hrs</th>
                  <th className="font-medium px-4 py-2.5 text-right">Pay</th>
                </tr>
              </thead>
              <tbody>
                {data.labour.map(s => (
                  <tr key={s.surveyor_id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-3 text-gray-900">{s.name}</td>
                    <td className="px-4 py-3 text-right tnum text-gray-600">{s.regular_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right tnum text-gray-900 font-medium">{s.overtime_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right">
                      {s.pay.length === 0 ? <span className="text-gray-300">—</span> : (
                        <div className="flex flex-col items-end gap-0.5">
                          {s.pay.map(p => <span key={p.currency} className="tnum text-gray-700">{money(p.total, p.currency)}</span>)}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <InvoicesTable rows={paged} manage onChanged={load} hrefFor={r => r.job_id ? `/admin/jobs/${r.job_id}` : null} />
          {filtered.length > shown && (
            <div className="text-center pt-1">
              <button onClick={() => setShown(s => s + INVOICES_PAGE)} className="btn-secondary">
                Show more ({filtered.length - shown} more)
              </button>
            </div>
          )}
        </>
      )}
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

// ── Client rates ─────────────────────────────────────────────────────────────
function RatesTab() {
  const [clients, setClients] = useState<Client[]>([])
  const [clientId, setClientId] = useState('')
  const [rates, setRates] = useState<ClientRate[]>([])
  const [jobTypes, setJobTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    (async () => {
      const supabase = createClient()
      const [{ data: cli }, jt] = await Promise.all([
        supabase.from('clients').select('*').eq('is_active', true).order('name'),
        listJobTypes(),
      ])
      setClients((cli ?? []) as Client[])
      setJobTypes(jt.map(t => t.name))
      setLoading(false)
    })()
  }, [])

  async function loadRates(id: string) { setRates(id ? await listClientRates(id) : []) }
  useEffect(() => { loadRates(clientId) }, [clientId])

  if (loading) return <div className="skeleton h-32 w-full" />

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <label className="label-base">Client</label>
        <select value={clientId} onChange={e => setClientId(e.target.value)} className="input-base">
          <option value="">— Select a client —</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {clientId && (
        <div className="card divide-y divide-gray-100">
          {rates.length === 0 && !adding && <p className="p-5 text-sm text-gray-400">No rates set for this client. Jobs will start blank.</p>}
          {rates.map(r => <RateRow key={r.id} rate={r} jobTypes={jobTypes} onChanged={() => loadRates(clientId)} />)}
          {adding && <RateEditor clientId={clientId} jobTypes={jobTypes} onDone={() => { setAdding(false); loadRates(clientId) }} />}
          {!adding && (
            <div className="p-4">
              <button onClick={() => setAdding(true)} className="btn-secondary py-1.5 px-3 text-sm"><Plus className="h-4 w-4" /> Add rate</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const RATE_TYPES: [ClientRate['rate_type'], string][] = [['fixed', 'Fixed'], ['hourly', 'Hourly'], ['per_unit', 'Per unit']]

function rateSummary(r: ClientRate): string {
  const base = money(Number(r.rate), r.currency)
  if (r.rate_type === 'hourly') return `${base} / hr`
  if (r.rate_type === 'per_unit') return `${base} / ${r.unit_label || 'unit'}`
  return base
}

function RateRow({ rate, jobTypes, onChanged }: { rate: ClientRate; jobTypes: string[]; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  if (editing) return <RateEditor clientId={rate.client_id} jobTypes={jobTypes} existing={rate} onDone={() => { setEditing(false); onChanged() }} />
  async function del() {
    if (!(await confirmDialog({ title: 'Delete rate?', message: 'Remove this billing rate?', confirmLabel: 'Delete', danger: true }))) return
    const res = await deleteClientRate(rate.id)
    if (res.error) { toast.error(res.error); return }
    toast.success('Rate deleted'); onChanged()
  }
  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div>
        <p className="text-sm font-medium text-gray-900">{rate.job_type || 'Any job type'} <span className="text-xs text-gray-400 font-normal">· {RATE_TYPES.find(t => t[0] === rate.rate_type)?.[1]}</span></p>
        <p className="text-sm text-gray-600 tnum">{rateSummary(rate)}</p>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => setEditing(true)} className="text-xs text-brand-600 hover:text-brand-800 font-medium px-2">Edit</button>
        <button onClick={del} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
}

function RateEditor({ clientId, jobTypes, existing, onDone }: { clientId: string; jobTypes: string[]; existing?: ClientRate; onDone: () => void }) {
  const [jobType, setJobType] = useState(existing?.job_type ?? '')
  const [rateType, setRateType] = useState<ClientRate['rate_type']>(existing?.rate_type ?? 'fixed')
  const [rate, setRate] = useState(existing ? String(existing.rate) : '')
  const [unitLabel, setUnitLabel] = useState(existing?.unit_label ?? '')
  const [currency, setCurrency] = useState<Currency>(existing?.currency ?? 'USD')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const payload = { client_id: clientId, job_type: jobType || null, rate_type: rateType, rate: Number(rate) || 0, unit_label: rateType === 'per_unit' ? (unitLabel || null) : null, currency }
    const res = existing ? await updateClientRate(existing.id, payload) : await addClientRate(payload as any)
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(existing ? 'Rate updated' : 'Rate added'); onDone()
  }

  const cell = 'input-base py-1.5 text-sm'
  return (
    <div className="p-4 bg-gray-50/60 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] text-gray-400">Job type</label>
          <select value={jobType} onChange={e => setJobType(e.target.value)} className={cell}>
            <option value="">Any job type</option>
            {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Rate type</label>
          <select value={rateType} onChange={e => setRateType(e.target.value as ClientRate['rate_type'])} className={cell}>
            {RATE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Rate</label>
          <input type="number" min={0} step="0.01" value={rate} onChange={e => setRate(e.target.value)} className={cell} />
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Currency</label>
          <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={cell}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
        </div>
        {rateType === 'per_unit' && (
          <div className="sm:col-span-2">
            <label className="text-[11px] text-gray-400">Unit label</label>
            <input value={unitLabel} onChange={e => setUnitLabel(e.target.value)} placeholder="e.g. vessel" className={cell} />
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving || !rate} className="btn-primary py-1.5 px-3 text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save</button>
        <button onClick={onDone} className="btn-secondary py-1.5 px-3 text-sm">Cancel</button>
      </div>
    </div>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────
function SettingsTab() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [taxName, setTaxName] = useState('')
  const [taxRate, setTaxRate] = useState('')
  const [overdue, setOverdue] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getAppSettings().then(s => {
      setSettings(s)
      if (s) { setTaxName(s.default_tax_name); setTaxRate(String(s.default_tax_rate)); setOverdue(String(s.overdue_days)) }
    })
  }, [])

  async function save() {
    setSaving(true)
    const res = await updateAppSettings({ default_tax_name: taxName, default_tax_rate: Number(taxRate) || 0, overdue_days: Number(overdue) || 0 })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Settings saved')
  }

  if (!settings) return <div className="skeleton h-32 w-full max-w-md" />

  return (
    <div className="space-y-6 max-w-md">
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
      <button onClick={save} disabled={saving} className="btn-primary py-2 px-4 text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save settings</button>
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
    if (!(await confirmDialog({ title: 'Delete bank account?', message: `Remove "${a.label}"? Invoices already issued keep the details they were printed with.`, confirmLabel: 'Delete', danger: true }))) return
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
