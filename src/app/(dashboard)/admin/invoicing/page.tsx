'use client'

// Admin invoicing hub: the invoices ledger, per-client billing rates, and the
// invoicing defaults (tax + overdue window). Invoices are created on each job;
// this page is the cross-job view + the rate/settings configuration.

import { useEffect, useState } from 'react'
import { Receipt, Plus, X, Loader2, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { cn } from '@/lib/utils'
import { CURRENCIES, money, listJobTypes } from '@/lib/jobs/tracker'
import {
  listInvoices, isOverdue, listClientRates, addClientRate, updateClientRate, deleteClientRate,
  getAppSettings, updateAppSettings, type InvoiceListRow,
} from '@/lib/jobs/invoicing'
import InvoicesTable from '@/components/invoicing/InvoicesTable'
import type { Client, ClientRate, Currency, AppSettings, Invoice } from '@/lib/types/database'

type Tab = 'invoices' | 'rates' | 'settings'
type StatusFilter = 'open' | Invoice['status'] | 'all'

export default function AdminInvoicingPage() {
  const [tab, setTab] = useState<Tab>('invoices')
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-rise">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center"><Receipt className="h-5 w-5 text-brand-600" /></div>
        <div>
          <h1 className="page-title">Invoicing</h1>
          <p className="text-gray-500 text-sm mt-0.5">Invoices, client rates and billing defaults.</p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {([['invoices', 'Invoices'], ['rates', 'Client rates'], ['settings', 'Settings']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'rates' && <RatesTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}

// ── Invoices ledger ──────────────────────────────────────────────────────────
function InvoicesTab() {
  const [rows, setRows] = useState<InvoiceListRow[] | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('open')

  useEffect(() => { listInvoices().then(setRows) }, [])

  const filtered = (rows ?? []).filter(r => {
    if (filter === 'all') return true
    if (filter === 'open') return r.status !== 'paid' && r.status !== 'void'
    if (filter === 'overdue') return isOverdue(r)
    return r.status === filter
  })

  const filters: [StatusFilter, string][] = [['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid'], ['all', 'All']]

  return (
    <div className="space-y-4">
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
        <InvoicesTable rows={filtered} hrefFor={r => r.job_id ? `/admin/jobs/${r.job_id}` : null} />
      )}
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
    <div className="card p-5 max-w-md space-y-4">
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
  )
}
