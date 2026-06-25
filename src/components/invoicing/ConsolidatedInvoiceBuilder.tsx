'use client'

// Finance-side invoice creation. Pulls the jobs that are done but not yet billed,
// filtered by client (and optionally month), so you can put many vessels on ONE
// invoice — and address it to a third-party payer (the "bill to" dropdown) when
// someone other than the work client pays (e.g. ASCO pays for BP's vessels).
// Creating the invoice stamps each job with it, so each vessel shows its invoice.

import { useCallback, useEffect, useState } from 'react'
import { Plus, X, Loader2, Receipt, Users, CheckSquare, Square, Paperclip } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { money, CURRENCIES, listJobTypes } from '@/lib/jobs/tracker'
import {
  listBillingClients, listInvoiceableJobs, listClientRates, getAppSettings, listBankAccounts,
  createConsolidatedInvoice, getLatestInvoiceNumber, computeTotals, type InvoiceableJob, type TaxDraft,
} from '@/lib/jobs/invoicing'
import LineItemsEditor, { type DraftLine } from '@/components/invoicing/LineItemsEditor'
import type { Currency, ClientRate, BankAccount } from '@/lib/types/database'

interface LineState { description: string; qty: number; unit_price: number }

export default function ConsolidatedInvoiceBuilder({ onCreated }: { onCreated?: () => void }) {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState('')
  const [billToId, setBillToId] = useState('') // '' = same as the work client
  const [month, setMonth] = useState('')       // '' = all months

  const [jobs, setJobs] = useState<InvoiceableJob[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [rates, setRates] = useState<ClientRate[]>([])
  const [lines, setLines] = useState<Record<string, LineState>>({}) // keyed by job id
  const [extra, setExtra] = useState<DraftLine[]>([])               // manual lines + expenses

  const [currency, setCurrency] = useState<Currency>('USD')
  const [invNumber, setInvNumber] = useState('')
  const [lastInvNumber, setLastInvNumber] = useState<string | null>(null)
  const [dueDate, setDueDate] = useState('')
  const [attention, setAttention] = useState('')
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [bankDetails, setBankDetails] = useState('')
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [bankAccountId, setBankAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [taxes, setTaxes] = useState<TaxDraft[]>([])
  const [saving, setSaving] = useState(false)
  // Standalone (no jobs ticked): a job is created for the invoice on the job sheet.
  const [jobTypes, setJobTypes] = useState<string[]>([])
  const [newJobVessel, setNewJobVessel] = useState('')
  const [newJobType, setNewJobType] = useState('')

  // Clients + billing defaults + the last invoice number + bank accounts, once.
  useEffect(() => {
    listBillingClients().then(setClients)
    getLatestInvoiceNumber().then(setLastInvNumber)
    listJobTypes().then(ts => setJobTypes(ts.map(t => t.name)))
    getAppSettings().then(s => { if (s) setTaxes([{ name: s.default_tax_name, rate: Number(s.default_tax_rate) }]) })
    listBankAccounts(true).then(accts => {
      setBankAccounts(accts)
      const def = accts.find(a => a.is_default) ?? accts[0]
      if (def) { setBankAccountId(def.id); setBankDetails(def.details) }
    })
  }, [])

  function pickBank(id: string) {
    setBankAccountId(id)
    const a = bankAccounts.find(x => x.id === id)
    if (a) setBankDetails(a.details)
  }

  const seedLine = useCallback((job: InvoiceableJob, clientRates: ClientRate[]): LineState => {
    const active = clientRates.filter(r => r.is_active)
    const rate = active.find(r => r.job_type === job.job_type) ?? active.find(r => !r.job_type) ?? null
    const label = job.vessel_name ? `M.V. ${job.vessel_name}` : (job.report_number ?? 'Survey')
    // Hourly rate → bill hours × rate: seed qty with the job's billable hours (from
    // the checklist, else the labour ledger). Fixed / per-unit rates stay qty 1.
    const qty = rate?.rate_type === 'hourly' && job.billable_hours && job.billable_hours > 0 ? job.billable_hours : 1
    return { description: job.job_type ? `${label} — ${job.job_type}` : label, qty, unit_price: rate ? Number(rate.rate) : 0 }
  }, [])

  // Reload the available jobs (+ rates) on client/month change. Auto-selects every
  // job — the common case is "bill all of this client's vessels for the month".
  const loadJobs = useCallback(async () => {
    if (!clientId) { setJobs([]); setLines({}); return }
    setLoadingJobs(true)
    const [js, rs] = await Promise.all([
      listInvoiceableJobs({ clientId, month: month || undefined }),
      listClientRates(clientId),
    ])
    setRates(rs)
    setJobs(js)
    const seeded: Record<string, LineState> = {}
    js.forEach(j => { seeded[j.id] = seedLine(j, rs) })
    setLines(seeded)
    const firstRate = rs.find(r => r.is_active)
    if (firstRate) setCurrency(firstRate.currency)
    setLoadingJobs(false)
  }, [clientId, month, seedLine])

  useEffect(() => { loadJobs() }, [loadJobs])

  const toggle = (job: InvoiceableJob) => setLines(prev => {
    const next = { ...prev }
    if (next[job.id]) delete next[job.id]
    else next[job.id] = seedLine(job, rates)
    return next
  })
  const allSelected = jobs.length > 0 && jobs.every(j => lines[j.id])
  const toggleAll = () => setLines(prev => {
    if (jobs.every(j => prev[j.id])) return {}
    const all: Record<string, LineState> = {}
    jobs.forEach(j => { all[j.id] = prev[j.id] ?? seedLine(j, rates) })
    return all
  })
  const setLine = (id: string, patch: Partial<LineState>) => setLines(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  const setTax = (i: number, patch: Partial<TaxDraft>) => setTaxes(ts => ts.map((t, j) => j === i ? { ...t, ...patch } : t))

  const orderedLines = jobs.filter(j => lines[j.id]).map(j => ({ job: j, ...lines[j.id] }))
  const allDrafts = [
    ...orderedLines.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price })),
    ...extra.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price })),
  ]
  const lineCount = orderedLines.length + extra.length
  const totals = computeTotals(allDrafts, taxes)
  const clientName = clients.find(c => c.id === clientId)?.name ?? ''
  const billToName = clients.find(c => c.id === billToId)?.name ?? ''

  // The note saved against this client's rate for a job's type (e.g. initial/final fees).
  function rateNoteFor(job: InvoiceableJob): string | null {
    const active = rates.filter(r => r.is_active)
    return (active.find(r => r.job_type === job.job_type) ?? active.find(r => !r.job_type))?.notes ?? null
  }

  // When the matched rate is hourly, show that the line's qty came from the job's
  // billable hours (checklist total or labour ledger) — so it's clear the chain is linked.
  function hoursHintFor(job: InvoiceableJob): string | null {
    const active = rates.filter(r => r.is_active)
    const rate = active.find(r => r.job_type === job.job_type) ?? active.find(r => !r.job_type)
    if (rate?.rate_type !== 'hourly') return null
    if (!job.billable_hours || job.billable_hours <= 0) return 'Hourly rate — no billable hours found on this job yet; enter the qty (hours) manually.'
    return `${job.billable_hours} billable hrs × ${money(Number(rate.rate), rate.currency)}/hr`
  }

  async function create() {
    if (!clientId) { toast.error('Choose a client'); return }
    if (lineCount === 0) { toast.error('Add at least one job, line or expense'); return }
    setSaving(true)
    const res = await createConsolidatedInvoice({
      client_id: clientId,
      bill_to_client_id: billToId || null,
      invoice_number: invNumber.trim() || null,
      currency, due_date: dueDate || null, notes: notes || null,
      description: description || null, reference: reference || null,
      attention: attention || null, bank_details: bankDetails || null,
      lines: [
        ...orderedLines.map(l => ({ job_id: l.job.id, description: l.description, qty: l.qty, unit_price: l.unit_price, is_expense: false })),
        ...extra.map(l => ({ job_id: null, description: l.description, qty: l.qty, unit_price: l.unit_price, is_expense: l.is_expense, receipt_path: l.receipt_path })),
      ],
      taxes: taxes.filter(t => t.name.trim()),
      // No vessels ticked → create a job for this invoice on the job sheet.
      new_job: orderedLines.length === 0 ? {
        title: newJobVessel.trim() ? `M.V. ${newJobVessel.trim()}` : `${clientName || 'Client'} — invoice`,
        vessel_name: newJobVessel.trim() || null,
        job_type: newJobType || null,
      } : null,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    const v = orderedLines.length
    toast.success(v > 0 ? `Invoice created for ${v} vessel${v === 1 ? '' : 's'}` : 'Invoice created — a job was added to the job sheet')
    setDescription(''); setReference(''); setAttention(''); setNotes(''); setDueDate(''); setInvNumber(''); setExtra([]); setNewJobVessel(''); setNewJobType('')
    getLatestInvoiceNumber().then(setLastInvNumber)
    await loadJobs() // billed jobs drop out of the list
    onCreated?.()
  }

  const cell = 'input-base py-1 text-sm'

  return (
    <div className="space-y-4">
      {/* 1 — Who & when */}
      <div className="card p-5 space-y-3">
        <h3 className="font-medium text-gray-900 flex items-center gap-2"><Users className="h-4 w-4 text-brand-500" /> Whose jobs to bill</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] text-gray-400">Client (vessels)</label>
            <select value={clientId} onChange={e => setClientId(e.target.value)} className={cell}>
              <option value="">— Select a client —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Month (optional)</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={cell} />
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Bill to (who pays)</label>
            <select value={billToId} onChange={e => setBillToId(e.target.value)} className={cell} disabled={!clientId}>
              <option value="">{clientName ? `Same as ${clientName}` : 'Same as client'}</option>
              {clients.filter(c => c.id !== clientId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {billToId && billToName && clientName && (
          <p className="text-[11px] text-brand-700 bg-brand-50/70 rounded-md px-2.5 py-1.5">
            Addressed to <strong>{billToName}</strong> for <strong>{clientName}</strong>&apos;s vessels.
          </p>
        )}
      </div>

      {/* 2 — Pick the vessels/jobs */}
      {clientId && (
        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50/60">
            <button onClick={toggleAll} disabled={jobs.length === 0} className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 disabled:opacity-40">
              {allSelected ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className="h-4 w-4 text-gray-400" />}
              Select all
            </button>
            <span className="ml-auto text-xs text-gray-400 tnum">{orderedLines.length} of {jobs.length} selected</span>
          </div>

          {loadingJobs ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10 w-full" />)}</div>
          ) : jobs.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">
              No jobs ready to invoice for {clientName}{month ? ` in ${month}` : ''}. Jobs appear here once they&apos;re report-ready or approved and not already on an invoice.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {jobs.map(j => {
                const sel = !!lines[j.id]
                const ls = lines[j.id]
                const note = rateNoteFor(j)
                const hoursHint = hoursHintFor(j)
                return (
                  <div key={j.id} className={sel ? 'px-4 py-3 bg-brand-50/30' : 'px-4 py-3'}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => toggle(j)} className="mt-0.5 shrink-0">
                        {sel ? <CheckSquare className="h-4 w-4 text-brand-600" /> : <Square className="h-4 w-4 text-gray-300 hover:text-gray-400" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-400">
                          <span className="tnum font-medium text-gray-600">{j.report_number ?? 'no report #'}</span>
                          {j.job_type && <span>· {j.job_type}</span>}
                          {j.scheduled_date && <span>· {formatDate(j.scheduled_date)}</span>}
                          {j.workflow_status === 'report_ready' && <span className="text-amber-600">· awaiting approval</span>}
                        </div>
                        {sel ? (
                          <div className="mt-1.5 grid grid-cols-[1fr_3.5rem_6rem_5rem] gap-2 items-center">
                            <input value={ls.description} onChange={e => setLine(j.id, { description: e.target.value })} className={cell} />
                            <input type="number" min={0} step="0.5" value={ls.qty} onChange={e => setLine(j.id, { qty: Number(e.target.value) })} className={`${cell} text-right`} />
                            <input type="number" min={0} step="0.01" value={ls.unit_price} onChange={e => setLine(j.id, { unit_price: Number(e.target.value) })} className={`${cell} text-right`} />
                            <span className="text-sm text-gray-700 text-right tnum">{((Number(ls.qty) || 0) * (Number(ls.unit_price) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        ) : (
                          <p className="text-sm text-gray-800 mt-0.5">{j.vessel_name ? `M.V. ${j.vessel_name}` : 'No vessel'}</p>
                        )}
                        {sel && hoursHint && <p className="text-[11px] text-brand-700 mt-1">{hoursHint}</p>}
                        {note && <p className="text-[11px] text-amber-700 mt-1">Rate note: {note}</p>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {jobs.length > 0 && (
            <div className="grid grid-cols-[1fr_3.5rem_6rem_5rem] gap-2 px-4 py-1.5 border-t border-gray-100 text-[11px] text-gray-400">
              <span>Selected lines · Description</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span>
            </div>
          )}
        </div>
      )}

      {/* 2b — Expenses & extra lines (works standalone, with no jobs ticked) */}
      {clientId && (
        <div className="card p-5 space-y-3">
          <div>
            <h3 className="font-medium text-gray-900 flex items-center gap-2"><Paperclip className="h-4 w-4 text-brand-500" /> Expenses &amp; extra lines</h3>
            <p className="text-xs text-gray-400">Reimbursable expenses (e.g. a launch) with the vendor receipt + value, or any extra line. Leave the vessels above unticked to bill a standalone invoice.</p>
          </div>
          <LineItemsEditor lines={extra} setLines={setExtra} currency={currency} />
        </div>
      )}

      {/* 3 — Invoice details */}
      {clientId && lineCount > 0 && (
        <div className="card p-5 space-y-3">
          <h3 className="font-medium text-gray-900 flex items-center gap-2"><Receipt className="h-4 w-4 text-brand-500" /> Invoice details</h3>

          {orderedLines.length === 0 && (
            <div className="rounded-lg bg-amber-50/60 border border-amber-100 p-3 space-y-2">
              <p className="text-xs text-amber-800">No vessels ticked — a job will be created on the job sheet for this invoice.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-gray-400">Vessel name (optional)</label>
                  <input value={newJobVessel} onChange={e => setNewJobVessel(e.target.value)} placeholder="e.g. Channel Pearl" className={cell} />
                </div>
                <div>
                  <label className="text-[11px] text-gray-400">Job type (optional)</label>
                  <select value={newJobType} onChange={e => setNewJobType(e.target.value)} className={cell}>
                    <option value="">—</option>
                    {jobTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-gray-400">Invoice no.</label>
              <input value={invNumber} onChange={e => setInvNumber(e.target.value)} placeholder="auto (YY-MM-NNN)" className={`${cell} tnum`} />
              <p className="text-[11px] text-gray-400 mt-0.5">{lastInvNumber ? <>Last: <span className="tnum">{lastInvNumber}</span> · blank = auto</> : 'Leave blank to auto-number'}</p>
            </div>
            <div>
              <label className="text-[11px] text-gray-400">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={cell}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div>
              <label className="text-[11px] text-gray-400">Due date</label>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={cell} />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Your ref / PO no. (optional)</label>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. PO 4500284686" className={cell} />
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Attention (optional)</label>
            <input value={attention} onChange={e => setAttention(e.target.value)} placeholder="e.g. Accounts Payable" className={cell} />
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Description / narrative (optional)</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder={'e.g. Monthly survey attendance — ' + (clientName || 'client') + ' vessels'} className="input-base text-sm resize-y" />
          </div>

          {/* Taxes */}
          <div className="space-y-2">
            {taxes.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2 items-center">
                <input value={t.name} onChange={e => setTax(i, { name: e.target.value })} placeholder="Tax name" className={cell} />
                <div className="relative"><input type="number" min={0} step="0.01" value={t.rate} onChange={e => setTax(i, { rate: Number(e.target.value) })} className={`${cell} text-right pr-5`} /><span className="absolute right-2 top-1.5 text-xs text-gray-400">%</span></div>
                <span className="text-sm text-gray-700 text-right tnum">{computeTotals(allDrafts, [t]).tax_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <button onClick={() => setTaxes(ts => ts.filter((_, j) => j !== i))} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setTaxes(ts => [...ts, { name: 'VAT', rate: 0 }])} className="btn-ghost py-1 px-2 text-xs text-brand-600"><Plus className="h-3.5 w-3.5" /> Add tax</button>
          </div>

          {/* Totals */}
          <div className="border-t border-gray-100 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-gray-500"><span>Subtotal</span><span className="tnum">{money(totals.subtotal, currency)}</span></div>
            {totals.tax_total > 0 && <div className="flex justify-between text-gray-500"><span>Tax</span><span className="tnum">{money(totals.tax_total, currency)}</span></div>}
            <div className="flex justify-between font-semibold text-gray-900"><span>Total</span><span className="tnum">{money(totals.total, currency)}</span></div>
          </div>

          <div>
            <label className="text-[11px] text-gray-400">Bank account <span className="text-gray-300">— shown on the invoice</span></label>
            {bankAccounts.length > 0 ? (
              <select value={bankAccountId} onChange={e => pickBank(e.target.value)} className={cell}>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{a.label}{a.currency ? ` (${a.currency})` : ''}</option>)}
                <option value="">Custom / none</option>
              </select>
            ) : (
              <p className="text-[11px] text-gray-400">No saved bank accounts — add them in Settings, or type details below.</p>
            )}
            <textarea value={bankDetails} onChange={e => { setBankDetails(e.target.value); setBankAccountId('') }} rows={3} placeholder="Bank name, account, SWIFT…" className="input-base text-sm resize-y mt-2" />
          </div>
          <div>
            <label className="text-[11px] text-gray-400">Internal notes (not on the invoice)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input-base text-sm resize-none" />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={create} disabled={saving} className="btn-primary py-2 px-4 text-sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              Create invoice{orderedLines.length > 0 ? ` (${orderedLines.length} ${orderedLines.length === 1 ? 'vessel' : 'vessels'})` : ''}
            </button>
            <span className="text-sm text-gray-400 tnum">{money(totals.total, currency)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
