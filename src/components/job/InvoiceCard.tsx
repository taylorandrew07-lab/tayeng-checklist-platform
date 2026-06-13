'use client'

// Admin billing card on the job detail: builds/edits the job's single invoice
// (number, bill-to, description narrative, line items, taxes, totals, bank
// details) and moves it draft → sent → paid, keeping the job's workflow status
// in step. The "PDF" button renders the printable tax invoice.

import { useCallback, useEffect, useState } from 'react'
import { Plus, X, Loader2, Receipt, Send, CheckCircle2, FileText, Mail } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { money, CURRENCIES, setWorkflowStatus, WORKFLOW_ORDER } from '@/lib/jobs/tracker'
import {
  getJobInvoice, saveJobInvoice, setInvoiceStatus, getClientRate, getAppSettings,
  computeTotals, type LineDraft, type TaxDraft,
} from '@/lib/jobs/invoicing'
import type { Job, Currency, Invoice } from '@/lib/types/database'

const blankLine = (): LineDraft => ({ description: '', qty: 1, unit_price: 0 })

const STATUS_PILL: Record<Invoice['status'], string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-cyan-100 text-cyan-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', void: 'bg-slate-200 text-slate-500',
}

export default function InvoiceCard({ job, onChanged }: { job: Job; onChanged: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [emailing, setEmailing] = useState(false)
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  const [status, setStatus] = useState<Invoice['status']>('draft')
  const [invNumber, setInvNumber] = useState('')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [dueDate, setDueDate] = useState('')
  const [reference, setReference] = useState('')
  const [attention, setAttention] = useState('')
  const [description, setDescription] = useState('')
  const [bankDetails, setBankDetails] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([blankLine()])
  const [taxes, setTaxes] = useState<TaxDraft[]>([])

  const load = useCallback(async () => {
    const existing = await getJobInvoice(job.id)
    if (existing) {
      const inv = existing.invoice
      setInvoiceId(inv.id)
      setStatus(inv.status)
      setInvNumber(inv.invoice_number ?? '')
      setCurrency(inv.currency)
      setDueDate(inv.due_date ?? '')
      setReference(inv.reference ?? '')
      setAttention(inv.attention ?? '')
      setDescription(inv.description ?? '')
      setBankDetails(inv.bank_details ?? '')
      setNotes(inv.notes ?? '')
      setLines(existing.lines.length ? existing.lines.map(l => ({ description: l.description, qty: Number(l.qty), unit_price: Number(l.unit_price) })) : [blankLine()])
      setTaxes(existing.taxes.map(t => ({ name: t.name, rate: Number(t.rate) })))
    } else {
      // Seed a fresh invoice from the client's default rate + standard tax + bank block.
      const [rate, settings] = await Promise.all([getClientRate(job.client_id, job.job_type), getAppSettings()])
      if (rate) {
        setCurrency(rate.currency)
        const label = rate.rate_type === 'hourly' ? `SURVEY FEES: hours at ${rate.currency}${Number(rate.rate)}/hr`
          : rate.rate_type === 'per_unit' ? `SURVEY FEES: ${rate.unit_label ?? 'units'} at ${rate.currency}${Number(rate.rate)}/${rate.unit_label ?? 'unit'}`
          : 'SURVEY FEES'
        setLines([{ description: label, qty: 1, unit_price: Number(rate.rate) }])
      } else {
        setLines([{ description: 'SURVEY FEES', qty: 1, unit_price: 0 }])
      }
      if (settings) {
        setTaxes([{ name: settings.default_tax_name, rate: Number(settings.default_tax_rate) }])
        if (settings.bank_details_default) setBankDetails(settings.bank_details_default)
      }
    }
    setLoading(false)
  }, [job.id, job.client_id, job.job_type])

  useEffect(() => { load() }, [load])

  const totals = computeTotals(lines, taxes)

  function setLine(i: number, patch: Partial<LineDraft>) { setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l)) }
  function setTax(i: number, patch: Partial<TaxDraft>) { setTaxes(ts => ts.map((t, j) => j === i ? { ...t, ...patch } : t)) }

  async function save() {
    const clean = lines.filter(l => l.description.trim() || l.unit_price)
    if (clean.length === 0) { toast.error('Add at least one line item'); return }
    setSaving(true)
    const res = await saveJobInvoice(job, {
      invoice_number: invNumber.trim() || null,
      currency, due_date: dueDate || null, notes: notes || null,
      description: description || null, reference: reference || null,
      attention: attention || null, bank_details: bankDetails || null,
      lines: clean, taxes: taxes.filter(t => t.name.trim()),
    })
    if (res.error) { setSaving(false); toast.error(res.error); return }
    if (WORKFLOW_ORDER.indexOf(job.workflow_status) < WORKFLOW_ORDER.indexOf('invoiced')) {
      await setWorkflowStatus(job.id, 'invoiced')
    }
    await load() // pick up the trigger-assigned number on first save
    setSaving(false)
    toast.success('Invoice saved')
    onChanged()
  }

  async function createDraft() {
    if (!invoiceId) return
    setEmailing(true)
    try {
      const res = await fetch(`/api/invoice-email/${invoiceId}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || 'Could not create the draft'); return }
      toast.success(json.noRecipient
        ? `Draft created in ${json.mailbox} — no client email on file, add a recipient in Outlook`
        : `Draft created in ${json.mailbox} for ${json.sentTo}`)
      if (json.webLink) window.open(json.webLink, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('Could not reach the email service')
    } finally {
      setEmailing(false)
    }
  }

  async function advance(next: 'sent' | 'paid') {
    if (!invoiceId) return
    if (next === 'paid' && !(await confirmDialog({ title: 'Mark invoice paid?', message: 'This records the invoice as fully paid.', confirmLabel: 'Mark paid' }))) return
    setSaving(true)
    const res = await setInvoiceStatus(invoiceId, next)
    if (!res.error) { await setWorkflowStatus(job.id, next); setStatus(next) }
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(next === 'sent' ? 'Invoice marked sent' : 'Invoice marked paid')
    onChanged()
  }

  if (loading) return <div className="card p-5"><div className="skeleton h-5 w-32 mb-4" /><div className="skeleton h-24 w-full" /></div>

  const cell = 'input-base py-1 text-sm'
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="font-medium text-gray-900 flex items-center gap-2"><Receipt className="h-4 w-4 text-brand-500" /> Invoice</h3>
        <div className="flex items-center gap-2">
          {invoiceId && (
            <a href={`/api/invoice-pdf/${invoiceId}`} target="_blank" rel="noopener noreferrer" className="btn-ghost py-1 px-2 text-xs text-brand-600"><FileText className="h-3.5 w-3.5" /> PDF</a>
          )}
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[status]}`}>{status[0].toUpperCase() + status.slice(1)}</span>
        </div>
      </div>

      {/* Number / currency / due date */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className="text-[11px] text-gray-400">Invoice no.</label>
          <input value={invNumber} onChange={e => setInvNumber(e.target.value)} placeholder="auto (YY-MM-NNN)" className={`${cell} tnum`} />
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

      {/* Bill-to extras */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[11px] text-gray-400">Attention (optional)</label>
          <input value={attention} onChange={e => setAttention(e.target.value)} placeholder="e.g. Operations Manager" className={cell} />
        </div>
        <div>
          <label className="text-[11px] text-gray-400">Your ref / PO no. (optional)</label>
          <input value={reference} onChange={e => setReference(e.target.value)} placeholder="e.g. PO 4500284686" className={cell} />
        </div>
      </div>

      {/* Description narrative */}
      <div className="mb-3">
        <label className="text-[11px] text-gray-400">Description</label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} placeholder={'References + narrative, e.g.\nM.V. CHANNEL PEARL V041\nTO: Attending on board the vessel… in order to carry out…'} className="input-base text-sm resize-y" />
        <p className="text-[11px] text-gray-400 mt-1">Appears in the DESCRIPTION column. First line is bolded; line breaks are kept.</p>
      </div>

      {/* Line items */}
      <div className="space-y-2 mb-3">
        <div className="grid grid-cols-[1fr_4rem_6rem_5rem_auto] gap-2 text-[11px] text-gray-400 px-1">
          <span>Line item</span><span className="text-right">Qty</span><span className="text-right">Unit price</span><span className="text-right">Amount</span><span />
        </div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_4rem_6rem_5rem_auto] gap-2 items-center">
            <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="e.g. SURVEY FEES" className={cell} />
            <input type="number" min={0} step="0.5" value={l.qty} onChange={e => setLine(i, { qty: Number(e.target.value) })} className={`${cell} text-right`} />
            <input type="number" min={0} step="0.01" value={l.unit_price} onChange={e => setLine(i, { unit_price: Number(e.target.value) })} className={`${cell} text-right`} />
            <span className="text-sm text-gray-700 text-right tnum">{((Number(l.qty) || 0) * (Number(l.unit_price) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <button onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        <button onClick={() => setLines(ls => [...ls, blankLine()])} className="btn-ghost py-1 px-2 text-xs text-brand-600"><Plus className="h-3.5 w-3.5" /> Add line</button>
      </div>

      {/* Taxes */}
      <div className="space-y-2 mb-4">
        {taxes.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2 items-center">
            <input value={t.name} onChange={e => setTax(i, { name: e.target.value })} placeholder="Tax name" className={cell} />
            <div className="relative"><input type="number" min={0} step="0.01" value={t.rate} onChange={e => setTax(i, { rate: Number(e.target.value) })} className={`${cell} text-right pr-5`} /><span className="absolute right-2 top-1.5 text-xs text-gray-400">%</span></div>
            <span className="text-sm text-gray-700 text-right tnum">{computeTotals(lines, [t]).tax_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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

      {/* Bank details */}
      <div className="mt-4">
        <label className="text-[11px] text-gray-400">Bank details (optional — shown on the invoice, used for foreign payments)</label>
        <textarea value={bankDetails} onChange={e => setBankDetails(e.target.value)} rows={2} placeholder="Bank name, account, SWIFT…" className="input-base text-sm resize-y" />
      </div>

      {/* Internal notes */}
      <div className="mt-3">
        <label className="text-[11px] text-gray-400">Internal notes (not on the invoice)</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input-base text-sm resize-none" />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button onClick={save} disabled={saving} className="btn-primary py-1.5 px-3 text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{invoiceId ? 'Save invoice' : 'Create invoice'}</button>
        {invoiceId && <button onClick={createDraft} disabled={emailing} className="btn-secondary py-1.5 px-3 text-sm">{emailing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Email draft</button>}
        {invoiceId && status === 'draft' && <button onClick={() => advance('sent')} disabled={saving} className="btn-secondary py-1.5 px-3 text-sm"><Send className="h-4 w-4" /> Mark sent</button>}
        {invoiceId && (status === 'sent' || status === 'overdue') && <button onClick={() => advance('paid')} disabled={saving} className="btn-secondary py-1.5 px-3 text-sm"><CheckCircle2 className="h-4 w-4" /> Mark paid</button>}
      </div>
    </div>
  )
}
