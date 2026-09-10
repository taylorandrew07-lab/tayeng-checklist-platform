'use client'

// Fees and costs on a case: the correspondency fee when the file opens, and third-party
// or contractor costs. Same shape — a dated one-time amount in a currency — so one card.
//
// A receipt attaches straight to the row. That was the missing half of "I have an invoice
// for Ocean Sun and nowhere to put it": the column existed and the API wrote it, but no
// screen ever offered an uploader.
//
// A CLAIMED charge is read-only, for the same reason a claimed attendance is: its claim
// carries a total that went out on an invoice raised outside this app.

import { useState, useRef } from 'react'
import { Plus, Pencil, Trash2, Loader2, Paperclip, CheckCircle2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { formatDate, withTimeout } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import {
  addCharge, updateCharge, deleteCharge, uploadDocument,
  CURRENCIES, CASE_CHARGE_KIND,
  type CaseCharge, type CaseChargeKind, type ChargeInput,
} from '@/lib/cases/api'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const BLANK = {
  kind: 'correspondency' as CaseChargeKind,
  description: '', payee: '', on: todayKey(), qty: '1', amount: '', currency: 'USD',
}

export default function CaseCharges({ caseId, charges, onChanged }: {
  caseId: string
  charges: CaseCharge[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [f, setF] = useState({ ...BLANK })
  const [busy, setBusy] = useState(false)
  const [attachTo, setAttachTo] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)

  function cancel() { setEditId(null); setOpen(false); setF({ ...BLANK }) }

  function startEdit(c: CaseCharge) {
    setEditId(c.id); setOpen(true)
    setF({
      kind: c.kind, description: c.description, payee: c.payee ?? '',
      on: c.incurred_on, qty: String(c.qty), amount: String(c.unit_amount), currency: c.currency,
    })
  }

  async function save() {
    if (!f.description.trim()) { toast.error('Give the charge a description'); return }
    const amt = Number(f.amount)
    if (!(amt > 0)) { toast.error('Enter an amount'); return }
    const input: ChargeInput = {
      kind: f.kind, description: f.description, payee: f.payee,
      incurred_on: f.on, qty: Number(f.qty) || 1, unit_amount: amt, currency: f.currency,
    }
    setBusy(true)
    const res = editId ? await updateCharge(editId, input) : await addCharge(caseId, input)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    cancel(); onChanged()
  }

  async function remove(c: CaseCharge) {
    if (!(await confirmDialog({
      title: 'Delete this charge?',
      message: `${c.description} — ${money(c.amount)} ${c.currency}`,
      confirmLabel: 'Delete', danger: true,
    }))) return
    const res = await deleteCharge(c.id)
    if (res.error) { toast.error(res.error); return }
    onChanged()
  }

  async function onReceipt(files: FileList | null) {
    const chargeId = attachTo
    setAttachTo(null)
    if (!files?.length || !chargeId) return
    const file = files[0]
    const res = await withTimeout(uploadDocument(caseId, file, { chargeId, category: 'Receipt' }), 60_000, 'Uploading')
      .catch((e: Error) => ({ error: e.message }))
    if (pick.current) pick.current.value = ''
    if (res.error) { toast.error(res.error); return }
    toast.success('Receipt attached')
    onChanged()
  }

  return (
    <div className="card">
      <input ref={pick} type="file" className="hidden" onChange={e => onReceipt(e.target.files)} />

      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
        <h2 className="section-title">Fees and costs</h2>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs">
            <Plus className="h-4 w-4" />Add charge
          </button>
        )}
      </div>

      {open && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label-base" htmlFor="cc-kind">Type</label>
              <select id="cc-kind" className="input-base w-48" value={f.kind}
                onChange={e => setF(p => ({ ...p, kind: e.target.value as CaseChargeKind }))}>
                {(Object.keys(CASE_CHARGE_KIND) as CaseChargeKind[]).map(k => (
                  <option key={k} value={k}>{CASE_CHARGE_KIND[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-base" htmlFor="cc-on">Date</label>
              <input id="cc-on" type="date" className="input-base w-40" value={f.on}
                onChange={e => setF(p => ({ ...p, on: e.target.value }))} />
            </div>
            <div className="w-20">
              <label className="label-base" htmlFor="cc-qty">Qty</label>
              <input id="cc-qty" type="number" min="0" step="1" inputMode="numeric"
                className="input-base text-right tnum" value={f.qty}
                onChange={e => setF(p => ({ ...p, qty: e.target.value }))} />
            </div>
            <div className="w-32">
              <label className="label-base" htmlFor="cc-amt">Amount</label>
              <input id="cc-amt" type="number" min="0" step="0.01" inputMode="decimal"
                className="input-base text-right tnum" value={f.amount}
                onChange={e => setF(p => ({ ...p, amount: e.target.value }))} />
            </div>
            <div className="w-24">
              <label className="label-base" htmlFor="cc-ccy">Currency</label>
              <select id="cc-ccy" className="input-base" value={f.currency}
                onChange={e => setF(p => ({ ...p, currency: e.target.value }))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="label-base" htmlFor="cc-desc">Description</label>
              <input id="cc-desc" className="input-base" value={f.description}
                placeholder={f.kind === 'correspondency' ? 'Opening of case file' : 'e.g. Launch hire'}
                onChange={e => setF(p => ({ ...p, description: e.target.value }))} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="label-base" htmlFor="cc-payee">Paid to</label>
              <input id="cc-payee" className="input-base" value={f.payee} placeholder="Optional"
                onChange={e => setF(p => ({ ...p, payee: e.target.value }))} />
            </div>
            <div className="flex gap-2 items-end">
              <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editId ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editId ? 'Save' : 'Add'}
              </button>
              <button type="button" onClick={cancel} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {charges.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          No fees or costs yet — the correspondency fee usually goes on when the file opens.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {charges.map(c => (
            <div key={c.id} className={`flex flex-wrap items-center gap-3 px-6 py-3 ${editId === c.id ? 'bg-brand-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 truncate">
                  {c.description}{c.payee ? <span className="text-gray-500"> — {c.payee}</span> : null}
                </p>
                <p className="text-xs text-gray-500">
                  {CASE_CHARGE_KIND[c.kind]} · {formatDate(c.incurred_on)}
                  {c.document_count > 0 && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-gray-400">
                      <Paperclip className="h-3 w-3" />{c.document_count}
                    </span>
                  )}
                </p>
              </div>
              <span className="text-sm text-gray-900 tnum w-28 text-right">{money(c.amount)} {c.currency}</span>
              <span className="w-24 text-right text-xs flex-shrink-0">
                {c.claim_no
                  ? <span className="text-gray-400">claim #{c.claim_no}</span>
                  : <span className="text-brand-700">unclaimed</span>}
              </span>
              <span className="flex items-center flex-shrink-0">
                <button type="button" onClick={() => { setAttachTo(c.id); pick.current?.click() }}
                  aria-label="Attach a receipt" title="Attach a receipt or invoice"
                  className="btn-ghost p-1 text-gray-400 hover:text-brand-700">
                  <Paperclip className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => startEdit(c)} disabled={!!c.claim_id}
                  aria-label="Edit this charge"
                  title={c.claim_id ? `On claim #${c.claim_no} — undo it to make changes` : 'Edit this charge'}
                  className="btn-ghost p-1 text-gray-400 hover:text-brand-700 disabled:opacity-30">
                  <Pencil className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => remove(c)} disabled={!!c.claim_id}
                  aria-label="Delete this charge"
                  title={c.claim_id ? `On claim #${c.claim_no} — undo it first` : 'Delete this charge'}
                  className="btn-ghost p-1 text-gray-400 hover:text-red-600 disabled:opacity-30">
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
