'use client'

// Fees and costs on a case — everything the case is owed for, in one card.
//
// WHAT IT IS IS TYPED, NOT PICKED. This was four fixed options (correspondency, third
// party, disbursement, other). A launch hire, a courier, a police report fee and a diver
// are four different things and only one of them is a "disbursement", so the field is free
// text with suggestions, like the case type. Migration 219 took the CHECK off.
//
// SOME FEES ARE TIME. A phone call or an email is not a purchase and it is not an
// attendance either — nobody went anywhere — it is the correspondency service, charged by
// the hour. So a fee can carry minutes (mig 220): type "Phone call" and the form asks how
// long and when instead of a quantity, and the database works the money out from the rate.
// Whole minutes, divided by 60 once, at the end: six ten-minute blocks are exactly one
// hour, never the 1.02 that six copies of 0.17 would give.
//
// AND THE RATE IS SET ONCE. Typing it on every line is how half of them ended up unpriced.
// The case remembers what a call and an email are worth (cases.rate_defaults) and a
// one-tap entry prices itself. A missing rate never blocks an entry — it stays outstanding
// rather than being claimed at zero.
//
// A receipt attaches straight to a row, and a CLAIMED row is read-only: its claim carries
// a total that went out on an invoice raised outside this app.

import { useState, useRef } from 'react'
import { Plus, Pencil, Trash2, Loader2, Paperclip, CheckCircle2, Clock, Tag } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { formatDate, withTimeout } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import QuickBlocks from '@/components/cases/QuickBlocks'
import { chargeKindLabel, isTimeKind, CHARGE_KIND_SUGGESTIONS } from '@/lib/cases/chargeKind'
import { DURATION_CHOICES, formatMinutes } from '@/lib/cases/minutes'
import {
  addCharge, updateCharge, deleteCharge, uploadDocument, updateCase,
  rateDefaultFor, CURRENCIES,
  type CaseRow, type CaseCharge, type ChargeInput,
} from '@/lib/cases/api'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const BLANK = {
  kind: '', description: '', payee: '', on: todayKey(),
  qty: '1', amount: '', currency: 'USD', minutes: '10', timed: false,
}

export default function CaseCharges({ kase, charges, onChanged }: {
  kase: CaseRow
  charges: CaseCharge[]
  onChanged: () => void
}) {
  const caseId = kase.id
  const [open, setOpen] = useState(false)
  const [rates, setRates] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [f, setF] = useState({ ...BLANK })
  const [rateTouched, setRateTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attachTo, setAttachTo] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)

  // A row that was logged as time stays time while you correct it — that is how the rate
  // on a call already logged gets fixed. A NEW entry decides from what you type.
  const timeMode = editId ? f.timed : isTimeKind(f.kind)

  function cancel() { setEditId(null); setOpen(false); setF({ ...BLANK }); setRateTouched(false) }

  function startEdit(c: CaseCharge) {
    setEditId(c.id); setOpen(true); setRateTouched(true)
    setF({
      ...BLANK,
      kind: chargeKindLabel(c.kind), description: c.description, payee: c.payee ?? '',
      on: c.incurred_on, qty: String(c.qty), amount: String(c.unit_amount), currency: c.currency,
      minutes: String(c.minutes ?? 10), timed: c.minutes != null,
    })
  }

  /** Typing the kind pulls in what this case pays for it, until you overrule it. */
  function onKind(kind: string) {
    const d = rateTouched ? null : rateDefaultFor(kase, kind)
    setF(p => ({ ...p, kind, ...(d ? { amount: String(d.rate), currency: d.currency } : {}) }))
  }

  async function save() {
    if (!f.kind.trim()) { toast.error('Say what this is'); return }
    const amt = Number(f.amount) || 0

    let input: ChargeInput
    if (timeMode) {
      const minutes = Number(f.minutes)
      if (!(minutes > 0)) { toast.error('Choose how long it took'); return }
      input = {
        kind: f.kind, description: f.description, payee: null,
        incurred_on: f.on, minutes, qty: 1, unit_amount: amt, currency: f.currency,
      }
    } else {
      if (!f.description.trim()) { toast.error('Give the charge a description'); return }
      if (!(amt > 0)) { toast.error('Enter an amount'); return }
      input = {
        kind: f.kind, description: f.description, payee: f.payee,
        incurred_on: f.on, minutes: null,
        qty: Number(f.qty) || 1, unit_amount: amt, currency: f.currency,
      }
    }

    setBusy(true)
    const res = editId ? await updateCharge(editId, input) : await addCharge(caseId, input)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    if (timeMode && amt === 0) toast.success('Logged with no rate — set one and it can be claimed')
    cancel(); onChanged()
  }

  async function remove(c: CaseCharge) {
    if (!(await confirmDialog({
      title: 'Delete this entry?',
      message: `${c.description || chargeKindLabel(c.kind)} — ${money(c.amount)} ${c.currency}`,
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

      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
        <h2 className="section-title">Fees and costs</h2>
        <div className="flex flex-wrap items-center gap-2">
          <QuickBlocks kase={kase} onAdded={onChanged} />
          <button type="button" onClick={() => setRates(r => !r)} aria-pressed={rates}
            className="btn-secondary text-xs" title="What a call or an email is worth on this case">
            <Tag className="h-4 w-4" />Rates
          </button>
          {!open && (
            <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs">
              <Plus className="h-4 w-4" />Add
            </button>
          )}
        </div>
      </div>

      {rates && <RatesPanel kase={kase} onSaved={onChanged} onClose={() => setRates(false)} />}

      {open && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="w-56">
              <label className="label-base" htmlFor="cc-kind">What is it</label>
              <input id="cc-kind" className="input-base" list="case-charge-kinds" value={f.kind}
                placeholder="Correspondency fee, phone call…"
                onChange={e => onKind(e.target.value)} />
              <datalist id="case-charge-kinds">
                {CHARGE_KIND_SUGGESTIONS.map(k => <option key={k} value={k} />)}
              </datalist>
            </div>
            <div>
              <label className="label-base" htmlFor="cc-on">Date</label>
              <input id="cc-on" type="date" className="input-base w-40" value={f.on}
                onChange={e => setF(p => ({ ...p, on: e.target.value }))} />
            </div>

            {timeMode ? (
              <div className="w-36">
                <label className="label-base" htmlFor="cc-mins">Time spent</label>
                <select id="cc-mins" className="input-base" value={f.minutes}
                  onChange={e => setF(p => ({ ...p, minutes: e.target.value }))}>
                  {DURATION_CHOICES.map(m => <option key={m} value={m}>{formatMinutes(m)}</option>)}
                </select>
              </div>
            ) : (
              <div className="w-20">
                <label className="label-base" htmlFor="cc-qty">Qty</label>
                <input id="cc-qty" type="number" min="0" step="1" inputMode="numeric"
                  className="input-base text-right tnum" value={f.qty}
                  onChange={e => setF(p => ({ ...p, qty: e.target.value }))} />
              </div>
            )}

            <div className="w-32">
              <label className="label-base" htmlFor="cc-amt">{timeMode ? 'Rate / hour' : 'Amount'}</label>
              <input id="cc-amt" type="number" min="0" step="0.01" inputMode="decimal"
                className="input-base text-right tnum" value={f.amount}
                placeholder={timeMode ? 'Optional' : ''}
                onChange={e => { setRateTouched(true); setF(p => ({ ...p, amount: e.target.value })) }} />
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
              <label className="label-base" htmlFor="cc-desc">
                {timeMode ? 'What it was about' : 'Description'}
              </label>
              <input id="cc-desc" className="input-base" value={f.description}
                placeholder={timeMode ? 'Optional'
                  : f.kind.toLowerCase().includes('correspondency') ? 'Opening of case file'
                  : 'e.g. Launch hire'}
                onChange={e => setF(p => ({ ...p, description: e.target.value }))} />
            </div>
            {!timeMode && (
              <div className="flex-1 min-w-[160px]">
                <label className="label-base" htmlFor="cc-payee">Paid to</label>
                <input id="cc-payee" className="input-base" value={f.payee} placeholder="Optional"
                  onChange={e => setF(p => ({ ...p, payee: e.target.value }))} />
              </div>
            )}
            <div className="flex gap-2 items-end">
              <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" />
                  : editId ? <CheckCircle2 className="h-4 w-4" />
                  : timeMode ? <Clock className="h-4 w-4" />
                  : <Plus className="h-4 w-4" />}
                {editId ? 'Save' : timeMode ? 'Log time' : 'Add'}
              </button>
              <button type="button" onClick={cancel} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>

          {timeMode && (
            <p className="text-xs text-gray-500">
              Charged by the hour — {formatMinutes(Number(f.minutes) || 0)} at{' '}
              {f.amount ? `${money(Number(f.amount))} ${f.currency}` : 'no rate yet'}
              {f.amount ? ` comes to ${money(Math.round(Number(f.amount) * (Number(f.minutes) || 0) / 60 * 100) / 100)} ${f.currency}` : '. Set the rate under Rates and every tap prices itself'}.
            </p>
          )}
        </div>
      )}

      {charges.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          Nothing yet — the correspondency fee usually goes on when the file opens, and a call
          or an email is two taps.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {charges.map(c => {
            const unpriced = c.minutes != null && !(c.unit_amount > 0)
            const meta = [
              // The kind is already the headline when nothing was typed about it — do not
              // print it twice.
              c.description ? chargeKindLabel(c.kind) : null,
              formatDate(c.incurred_on),
              c.start_time && c.end_time ? `${c.start_time.slice(0, 5)}–${c.end_time.slice(0, 5)}` : null,
              c.minutes != null ? formatMinutes(c.minutes) : null,
            ].filter(Boolean).join(' · ')

            return (
              <div key={c.id} className={`flex flex-wrap items-center gap-3 px-6 py-3 ${editId === c.id ? 'bg-brand-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">
                    {c.description || chargeKindLabel(c.kind)}
                    {c.payee ? <span className="text-gray-500"> — {c.payee}</span> : null}
                  </p>
                  <p className="text-xs text-gray-500">
                    {meta}
                    {c.document_count > 0 && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-gray-400">
                        <Paperclip className="h-3 w-3" />{c.document_count}
                      </span>
                    )}
                  </p>
                </div>
                <span className="text-sm tnum w-28 text-right"
                  title={c.minutes != null && c.unit_amount > 0 ? `${money(c.unit_amount)} ${c.currency} per hour` : undefined}>
                  {unpriced
                    ? <span className="text-amber-600">no rate</span>
                    : <span className="text-gray-900">{money(c.amount)} {c.currency}</span>}
                </span>
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
                    aria-label="Edit this entry"
                    title={c.claim_id ? `On claim #${c.claim_no} — undo it to make changes` : 'Edit this entry'}
                    className="btn-ghost p-1 text-gray-400 hover:text-brand-700 disabled:opacity-30">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => remove(c)} disabled={!!c.claim_id}
                    aria-label="Delete this entry"
                    title={c.claim_id ? `On claim #${c.claim_no} — undo it first` : 'Delete this entry'}
                    className="btn-ghost p-1 text-gray-400 hover:text-red-600 disabled:opacity-30">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** What a call and an email are worth on THIS case — one principal pays for correspondence
 *  at a rate another does not. Set here, applied by every tap of the quick buttons, and
 *  still editable line by line afterwards. */
function RatesPanel({ kase, onSaved, onClose }: {
  kase: CaseRow; onSaved: () => void; onClose: () => void
}) {
  const call = rateDefaultFor(kase, 'Phone call')
  const email = rateDefaultFor(kase, 'Email')
  const [f, setF] = useState({
    call: call ? String(call.rate) : '',
    email: email ? String(email.rate) : '',
    currency: call?.currency ?? email?.currency ?? 'USD',
  })
  const [busy, setBusy] = useState(false)

  async function save() {
    // Both rates live in the same JSON column, so they go in ONE write built from one
    // copy of it. Two merges racing would leave whichever landed second holding a map
    // taken before the first.
    const next = { ...(kase.rate_defaults ?? {}) }
    const put = (key: string, typed: string) => {
      const n = Number(typed)
      if (typed.trim() === '' || !(n > 0)) delete next[key]
      else next[key] = { rate: n, currency: f.currency }
    }
    put('phone call', f.call)
    put('email', f.email)

    setBusy(true)
    const res = await updateCase(kase.id, { rate_defaults: next } as Partial<CaseRow>)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Rates saved — quick entries will price themselves')
    onSaved(); onClose()
  }

  return (
    <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 space-y-3">
      <p className="text-xs text-gray-500">
        What this case pays by the hour. A tap of Phone call or Email prices itself from here,
        so the rate is typed once instead of on every line.
      </p>
      <div className="flex flex-wrap gap-3">
        <div className="w-36">
          <label className="label-base" htmlFor="cr-call">Phone call / hour</label>
          <input id="cr-call" type="number" min="0" step="0.01" inputMode="decimal"
            className="input-base text-right tnum" value={f.call} placeholder="Not set"
            onChange={e => setF(p => ({ ...p, call: e.target.value }))} />
        </div>
        <div className="w-36">
          <label className="label-base" htmlFor="cr-email">Email / hour</label>
          <input id="cr-email" type="number" min="0" step="0.01" inputMode="decimal"
            className="input-base text-right tnum" value={f.email} placeholder="Not set"
            onChange={e => setF(p => ({ ...p, email: e.target.value }))} />
        </div>
        <div className="w-24">
          <label className="label-base" htmlFor="cr-ccy">Currency</label>
          <select id="cr-ccy" className="input-base" value={f.currency}
            onChange={e => setF(p => ({ ...p, currency: e.target.value }))}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex gap-2 items-end">
          <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Save rates
          </button>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Close</button>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Leave one blank and that entry is still logged — it just stays outstanding until it has
        a rate, rather than being claimed at nothing.
      </p>
    </div>
  )
}
