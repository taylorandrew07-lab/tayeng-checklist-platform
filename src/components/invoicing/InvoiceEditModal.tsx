'use client'

// Edit an existing invoice after creation — header fields, line items, reimbursable
// expenses (with receipts + editable values) and taxes. Job-linked lines keep their
// vessel and can't be removed here. Used from the Finance invoices ledger.

import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SaveStatus } from '@/components/ui/SaveStatus'
import { toast } from '@/components/ui/toast'
import { CURRENCIES } from '@/lib/jobs/tracker'
import { getInvoiceForEdit, updateInvoice, listBankAccounts, listBillingClients, type TaxDraft } from '@/lib/jobs/invoicing'
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
  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  // Who the invoice is addressed to. '' = the work client itself. Correctable here
  // because getting the payer wrong (billed BPTT, should have been ASCO) otherwise
  // meant deleting the invoice and rebuilding it from scratch.
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [clientId, setClientId] = useState<string | null>(null)
  const [billToId, setBillToId] = useState('')
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
      setIssueDate(inv.issue_date ?? '')
      setDueDate(inv.due_date ?? '')
      setClientId(inv.client_id ?? null)
      setBillToId(inv.bill_to_client_id ?? '')
      setAttention(inv.attention ?? '')
      setReference(inv.reference ?? '')
      setDescription(inv.description ?? '')
      setBankDetails(inv.bank_details ?? '')
      setNotes(inv.notes ?? '')
      setLines(d.lines.map(l => ({
        key: crypto.randomUUID(), description: l.description, qty: l.qty, unit_price: l.unit_price,
        is_expense: l.is_expense, receipt_path: l.receipt_path, receipt_name: l.receipt_path ? 'Receipt' : null,
        job_id: l.job_id, vessel_name: l.vessel_name, vessel_type: l.vessel_type, report_number: l.report_number,
      })))
      setTaxes(d.taxes)
      loadedRef.current = true
      setLoading(false)
    })
  }, [invoiceId, onClose])

  // Saved bank accounts for the picker (active only) + the client list for the
  // bill-to dropdown — same as the create flow.
  useEffect(() => {
    listBankAccounts(true).then(setBankAccounts)
    listBillingClients().then(setClients)
  }, [])
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
  }, [number, currency, issueDate, dueDate, billToId, attention, reference, description, bankDetails, notes, lines, taxes])

  async function persist(): Promise<boolean> {
    if (lines.length === 0) return false
    setSaving(true)
    const res = await updateInvoice(invoiceId, {
      invoice_number: number.trim() || null,
      issue_date: issueDate || null,
      bill_to_client_id: billToId || null,
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
    [number, currency, issueDate, dueDate, billToId, attention, reference, description, bankDetails, notes, lines, taxes, dirty],
    { enabled: !loading },
  )

  // Flush any pending edit, then close + refresh the ledger.
  async function done() {
    if (dirty && !saving && lines.length) await persist()
    onSaved()
  }

  const workClientName = clients.find(c => c.id === clientId)?.name ?? ''
  const billToName = clients.find(c => c.id === billToId)?.name ?? ''

  const cell = 'input-base py-1 text-sm'
  return (
    <Modal open onClose={done} size="xl" title="Edit invoice" footer={
      <>
        <span className="mr-auto"><SaveStatus saving={saving} dirty={dirty} savedAt={savedAt} /></span>
        <button onClick={done} disabled={loading} className="btn-primary">Done</button>
      </>
    }>
      {loading ? (
        <div className="space-y-2"><div className="skeleton h-8 w-full" /><div className="skeleton h-24 w-full" /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div><label className="text-[11px] text-gray-400">Invoice no.</label><input value={number} onChange={e => setNumber(e.target.value)} className={`${cell} tnum`} /></div>
            <div><label className="text-[11px] text-gray-400">Invoice date</label><input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={cell} /></div>
            <div><label className="text-[11px] text-gray-400">Currency</label><select value={currency} onChange={e => setCurrency(e.target.value as Currency)} className={cell}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className="text-[11px] text-gray-400">Due date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={cell} /></div>
          </div>
          {/* Who the invoice is addressed to. Changing it re-addresses the PDF "To:"
              block and re-targets the invoice email, so a payer billed in error can be
              corrected in place instead of deleting and rebuilding the invoice. */}
          <div>
            <label className="text-[11px] text-gray-400">Bill to (who pays)</label>
            <select value={billToId} onChange={e => setBillToId(e.target.value)} className={cell}>
              <option value="">{workClientName ? `Same as ${workClientName}` : 'Same as the work client'}</option>
              {clients.filter(c => c.id !== clientId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {billToId && billToName && (
              <p className="text-[11px] text-brand-700 mt-1">
                Addressed to <strong>{billToName}</strong>{workClientName ? <> for <strong>{workClientName}</strong>&apos;s vessels</> : null}.
              </p>
            )}
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
