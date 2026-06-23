'use client'

// Edit an existing invoice after creation — header fields, line items, reimbursable
// expenses (with receipts + editable values) and taxes. Job-linked lines keep their
// vessel and can't be removed here. Used from the Finance invoices ledger.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Check, Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import { money, CURRENCIES } from '@/lib/jobs/tracker'
import { getInvoiceForEdit, updateInvoice, computeTotals, type TaxDraft } from '@/lib/jobs/invoicing'
import LineItemsEditor, { type DraftLine } from '@/components/invoicing/LineItemsEditor'
import { useAutoSave } from '@/lib/useAutoSave'
import type { Currency } from '@/lib/types/database'

export default function InvoiceEditModal({ invoiceId, onClose, onSaved }: { invoiceId: string; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [number, setNumber] = useState('')
  const [currency, setCurrency] = useState<Currency>('USD')
  const [dueDate, setDueDate] = useState('')
  const [attention, setAttention] = useState('')
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [bankDetails, setBankDetails] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [taxes, setTaxes] = useState<TaxDraft[]>([])
  const [dirty, setDirty] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const loadedRef = useRef(false)
  const skipDirtyRef = useRef(false)

  useEffect(() => {
    getInvoiceForEdit(invoiceId).then(d => {
      if (!d) { toast.error('Invoice not found'); onClose(); return }
      const inv = d.invoice
      skipDirtyRef.current = true // suppress the dirty flag for this hydration batch
      setNumber(inv.invoice_number ?? '')
      setCurrency(inv.currency)
      setDueDate(inv.due_date ?? '')
      setAttention(inv.attention ?? '')
      setReference(inv.reference ?? '')
      setDescription(inv.description ?? '')
      setBankDetails(inv.bank_details ?? '')
      setNotes(inv.notes ?? '')
      setLines(d.lines.map(l => ({
        key: crypto.randomUUID(), description: l.description, qty: l.qty, unit_price: l.unit_price,
        is_expense: l.is_expense, receipt_path: l.receipt_path, receipt_name: l.receipt_path ? 'Receipt' : null,
        job_id: l.job_id, vessel_name: l.vessel_name, report_number: l.report_number,
      })))
      setTaxes(d.taxes)
      loadedRef.current = true
      setLoading(false)
    })
  }, [invoiceId, onClose])

  const drafts = lines.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price }))
  const totals = computeTotals(drafts, taxes)
  const setTax = (i: number, patch: Partial<TaxDraft>) => setTaxes(ts => ts.map((t, j) => j === i ? { ...t, ...patch } : t))

  // Mark dirty after load, skipping the hydration batch (mirrors the template editor).
  useEffect(() => {
    if (!loadedRef.current) return
    if (skipDirtyRef.current) { skipDirtyRef.current = false; return }
    setDirty(true)
  }, [number, currency, dueDate, attention, reference, description, bankDetails, notes, lines, taxes])

  async function persist(): Promise<boolean> {
    if (lines.length === 0) return false
    setSaving(true)
    const res = await updateInvoice(invoiceId, {
      invoice_number: number.trim() || null,
      currency, due_date: dueDate || null, notes: notes || null,
      description: description || null, reference: reference || null, attention: attention || null, bank_details: bankDetails || null,
      lines: lines.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price, is_expense: l.is_expense, receipt_path: l.receipt_path, job_id: l.job_id })),
      taxes: taxes.filter(t => t.name.trim()),
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return false }
    setDirty(false); setSavedAt(new Date())
    return true
  }

  // Auto-save edits (debounced) — no Save button needed. persist() clears dirty so
  // this won't loop; updateInvoice replaces lines/taxes idempotently.
  useAutoSave(
    () => { if (dirty && !saving) void persist() },
    [number, currency, dueDate, attention, reference, description, bankDetails, notes, lines, taxes, dirty],
    { enabled: !loading },
  )

  // Flush any pending edit, then close + refresh the ledger.
  async function done() {
    if (dirty && !saving && lines.length) await persist()
    onSaved()
  }

  const cell = 'input-base py-1 text-sm'
  return (
    <Modal open onClose={done} size="xl" title="Edit invoice" footer={
      <>
        <span className="text-xs text-gray-400 mr-auto inline-flex items-center gap-1.5">
          {saving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</>
            : dirty ? 'Unsaved changes…'
            : savedAt ? <><Check className="h-3.5 w-3.5 text-green-600" /> All changes saved</>
            : null}
        </span>
        <button onClick={done} disabled={loading} className="btn-primary">Done</button>
      </>
    }>
      {loading ? (
        <div className="space-y-2"><div className="skeleton h-8 w-full" /><div className="skeleton h-24 w-full" /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className="text-[11px] text-gray-400">Invoice no.</label><input value={number} onChange={e => setNumber(e.target.value)} className={`${cell} tnum`} /></div>
            <div><label className="text-[11px] text-gray-400">Currency</label><select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={cell}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="text-[11px] text-gray-400">Due date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={cell} /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="text-[11px] text-gray-400">Attention</label><input value={attention} onChange={e => setAttention(e.target.value)} className={cell} /></div>
            <div><label className="text-[11px] text-gray-400">Your ref / PO no.</label><input value={reference} onChange={e => setReference(e.target.value)} className={cell} /></div>
          </div>
          <div><label className="text-[11px] text-gray-400">Description / narrative</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="input-base text-sm resize-y" /></div>

          <div>
            <label className="text-[11px] text-gray-400">Line items &amp; expenses</label>
            <LineItemsEditor lines={lines} setLines={setLines} currency={currency} />
          </div>

          <div className="space-y-2">
            {taxes.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2 items-center">
                <input value={t.name} onChange={e => setTax(i, { name: e.target.value })} placeholder="Tax name" className={cell} />
                <div className="relative"><input type="number" min={0} step="0.01" value={t.rate} onChange={e => setTax(i, { rate: Number(e.target.value) })} className={`${cell} text-right pr-5`} /><span className="absolute right-2 top-1.5 text-xs text-gray-400">%</span></div>
                <span className="text-sm text-gray-700 text-right tnum">{computeTotals(drafts, [t]).tax_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <button onClick={() => setTaxes(ts => ts.filter((_, j) => j !== i))} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setTaxes(ts => [...ts, { name: 'VAT', rate: 0 }])} className="btn-ghost py-1 px-2 text-xs text-brand-600"><Plus className="h-3.5 w-3.5" /> Add tax</button>
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-gray-500"><span>Subtotal</span><span className="tnum">{money(totals.subtotal, currency)}</span></div>
            {totals.tax_total > 0 && <div className="flex justify-between text-gray-500"><span>Tax</span><span className="tnum">{money(totals.tax_total, currency)}</span></div>}
            <div className="flex justify-between font-semibold text-gray-900"><span>Total</span><span className="tnum">{money(totals.total, currency)}</span></div>
          </div>

          <div><label className="text-[11px] text-gray-400">Bank details</label><textarea value={bankDetails} onChange={e => setBankDetails(e.target.value)} rows={2} className="input-base text-sm resize-y" /></div>
          <div><label className="text-[11px] text-gray-400">Internal notes (not on the invoice)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input-base text-sm resize-none" /></div>
        </div>
      )}
    </Modal>
  )
}
