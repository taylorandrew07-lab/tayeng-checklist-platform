'use client'

// Edit an existing invoice after creation — header fields, line items, reimbursable
// expenses (with receipts + editable values) and taxes. Job-linked lines keep their
// vessel and can't be removed here. Used from the Finance invoices ledger.

import { useEffect, useRef, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import { CURRENCIES } from '@/lib/jobs/tracker'
import { getInvoiceForEdit, updateInvoice, listBankAccounts, type TaxDraft } from '@/lib/jobs/invoicing'
import LineItemsEditor, { type DraftLine } from '@/components/invoicing/LineItemsEditor'
import { TaxEditor, TotalsSummary } from '@/components/invoicing/TaxEditor'
import { BankAccountPicker } from '@/components/invoicing/BankAccountPicker'
import { useAutoSave } from '@/lib/useAutoSave'
import type { Currency, BankAccount } from '@/lib/types/database'

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
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [bankAccountId, setBankAccountId] = useState('')
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

  // Saved bank accounts for the picker (active only) — same as the create flow.
  useEffect(() => { listBankAccounts(true).then(setBankAccounts) }, [])
  function pickBank(id: string) {
    setBankAccountId(id)
    const a = bankAccounts.find(x => x.id === id)
    if (a) setBankDetails(a.details)
  }

  const drafts = lines.map(l => ({ description: l.description, qty: l.qty, unit_price: l.unit_price }))

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

          <TaxEditor taxes={taxes} setTaxes={setTaxes} lines={drafts} />

          <TotalsSummary lines={drafts} taxes={taxes} currency={currency} />

          <BankAccountPicker
            bankAccounts={bankAccounts}
            bankAccountId={bankAccountId}
            bankDetails={bankDetails}
            currency={currency}
            onPickAccount={pickBank}
            onDetailsChange={d => { setBankDetails(d); setBankAccountId('') }}
          />
          <div><label className="text-[11px] text-gray-400">Internal notes (not on the invoice)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="input-base text-sm resize-none" /></div>
        </div>
      )}
    </Modal>
  )
}
