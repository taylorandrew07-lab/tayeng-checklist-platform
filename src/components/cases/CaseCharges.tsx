'use client'

// Fees and costs on a case — everything the case is owed for, in one card.
//
// WHAT IT IS IS TYPED, NOT PICKED. This was four fixed options (correspondency, third
// party, disbursement, other). A launch hire, a courier, a police report fee and a diver
// are four different things and only one of them is a "disbursement", so the field is free
// text with suggestions, like the case type. Migration 219 took the CHECK off.
//
// TIME OR QUANTITY — SAID OUT LOUD. A fee can be time (mig 220 gives it minutes and a
// clock span) and the money is then rate x minutes / 60, computed by the database. Which
// of the two you are entering used to be GUESSED from the words: "Phone call" was time,
// "Review of all documentation" was not, so two hours of reading had to be faked as a
// quantity of 2 and nothing on the line said what the 2 meant. It is a toggle now. Typing
// a phone call still flips it for you, but you can see it and you can overrule it.
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
import DurationField, {
  BLANK_DURATION, durationMinutes, durationTimes, durationFromRow, type DurationValue,
} from '@/components/cases/DurationField'
import { chargeKindLabel, isTimeKind, CHARGE_KIND_SUGGESTIONS } from '@/lib/cases/chargeKind'
import { formatMinutes } from '@/lib/cases/minutes'
import {
  addCharge, updateCharge, deleteCharge, uploadDocument, updateCase,
  rateDefaultFor, standingRate, RATE_DEFAULT_KEY, STARTING_HOURLY_RATE, CURRENCIES,
  type CaseRow, type CaseCharge, type ChargeInput,
} from '@/lib/cases/api'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Typed into the box, not greyed out behind it: correspondence is what most entries on
 *  a case are, so the answer is already there and a different one is typed over it. */
export const DEFAULT_CHARGE_KIND = "Correspondant's Fee"

// What a new entry starts as: the correspondant's fee, billed by TIME, entered as a clock
// span, priced at what this case charges. That is the shape of nearly every line on a
// case, and every part of it stays editable — the point is to stop retyping the same four
// answers, not to decide them.
const BLANK = {
  kind: DEFAULT_CHARGE_KIND, description: '', payee: '', on: todayKey(),
  qty: '1', amount: '', currency: 'USD',
  // Typed, or the literal 'span' narrows the field and a row entered in Hours cannot be
  // edited back into it.
  timed: true, dur: { ...BLANK_DURATION, mode: 'span' } as DurationValue,
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
  const [f, setF] = useState(fresh)
  const [rateTouched, setRateTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attachTo, setAttachTo] = useState<string | null>(null)
  const pick = useRef<HTMLInputElement>(null)

  /** todayKey() is read HERE, not at module load: a tab left open overnight would
   *  otherwise keep offering yesterday. */
  function fresh() {
    const r = standingRate(kase, DEFAULT_CHARGE_KIND)
    return { ...BLANK, on: todayKey(), amount: String(r.rate), currency: r.currency }
  }

  function cancel() { setEditId(null); setOpen(false); setF(fresh()); setRateTouched(false) }

  function startEdit(c: CaseCharge) {
    setEditId(c.id); setOpen(true); setRateTouched(true)
    setF({
      ...fresh(),
      kind: chargeKindLabel(c.kind), description: c.description, payee: c.payee ?? '',
      on: c.incurred_on, qty: String(c.qty), amount: String(c.unit_amount), currency: c.currency,
      timed: c.minutes != null,
      dur: durationFromRow(c.minutes, c.start_time, c.end_time),
    })
  }

  /** Typing the kind pulls in what this case pays for it, and puts the toggle where it
   *  most likely belongs — until you say otherwise, either way. */
  function onKind(kind: string) {
    const d = rateTouched ? null : rateDefaultFor(kase, kind)
    setF(p => ({
      ...p, kind,
      // Only ever ON. A new entry is already billed by time, and quietly flipping it back
      // to Quantity because the words did not look like a call is how the guessing went
      // wrong in the first place. The toggle is right there.
      timed: p.timed || (!editId && isTimeKind(kind)),
      ...(d ? { amount: String(d.rate), currency: d.currency } : {}),
    }))
  }

  async function save() {
    if (!f.kind.trim()) { toast.error('Say what this is'); return }
    const amt = Number(f.amount) || 0

    let input: ChargeInput
    if (f.timed) {
      const minutes = durationMinutes(f.dur)
      if (!(minutes > 0)) { toast.error('Enter how long it took'); return }
      input = {
        kind: f.kind, description: f.description, payee: null,
        incurred_on: f.on, minutes, ...durationTimes(f.dur),
        qty: 1, unit_amount: amt, currency: f.currency,
      }
    } else {
      if (!f.description.trim()) { toast.error('Give the charge a description'); return }
      if (!(amt > 0)) { toast.error('Enter an amount'); return }
      input = {
        kind: f.kind, description: f.description, payee: f.payee,
        incurred_on: f.on, minutes: null, start_time: null, end_time: null,
        qty: Number(f.qty) || 1, unit_amount: amt, currency: f.currency,
      }
    }

    setBusy(true)
    const res = editId ? await updateCharge(editId, input) : await addCharge(caseId, input)
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    if (f.timed && amt === 0) toast.success('Logged with no rate — set one and it can be claimed')
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

  const liveMinutes = durationMinutes(f.dur)

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
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <label className="label-base" htmlFor="cc-kind">What is it</label>
              <input id="cc-kind" className="input-base" list="case-charge-kinds" value={f.kind}
                placeholder="Phone call, launch hire…"
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
            {/* THE ONE THAT WAS MISSING. Two hours of reading is time, not a quantity of 2. */}
            <div>
              <span className="label-base">Billed by</span>
              <div className="flex rounded-lg border border-gray-300 overflow-hidden h-[38px]">
                {([[true, 'Time'], [false, 'Quantity']] as const).map(([t, text]) => (
                  <button key={text} type="button" onClick={() => setF(p => ({ ...p, timed: t }))}
                    aria-pressed={f.timed === t}
                    className={`px-3 text-xs transition-colors ${
                      f.timed === t ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {f.timed ? (
              <DurationField value={f.dur} onChange={d => setF(p => ({ ...p, dur: d }))} />
            ) : (
              <div className="w-20">
                <label className="label-base" htmlFor="cc-qty">Qty</label>
                <input id="cc-qty" type="number" min="0" step="1" inputMode="numeric"
                  className="input-base text-right tnum" value={f.qty}
                  onChange={e => setF(p => ({ ...p, qty: e.target.value }))} />
              </div>
            )}
            <div className="w-32">
              <label className="label-base" htmlFor="cc-amt">{f.timed ? 'Rate / hour' : 'Amount'}</label>
              <input id="cc-amt" type="number" min="0" step="0.01" inputMode="decimal"
                className="input-base text-right tnum" value={f.amount}
                placeholder={f.timed ? 'Optional' : ''}
                onChange={e => { setRateTouched(true); setF(p => ({ ...p, amount: e.target.value })) }} />
            </div>
            <div className="w-24">
              <label className="label-base" htmlFor="cc-ccy">Currency</label>
              <select id="cc-ccy" className="input-base" value={f.currency}
                onChange={e => setF(p => ({ ...p, currency: e.target.value }))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {f.timed && (
              <p className="text-sm text-gray-600 tnum pb-2">
                {liveMinutes > 0 && f.amount
                  ? `= ${money(Math.round(Number(f.amount) * liveMinutes / 60 * 100) / 100)} ${f.currency}`
                  : ''}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="label-base" htmlFor="cc-desc">
                {f.timed ? 'What it was about' : 'Description'}
              </label>
              <input id="cc-desc" className="input-base" value={f.description}
                placeholder={f.timed ? 'Optional'
                  : f.kind.toLowerCase().includes('correspond') ? 'Opening of case file'
                  : 'e.g. Launch hire'}
                onChange={e => setF(p => ({ ...p, description: e.target.value }))} />
            </div>
            {!f.timed && (
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
                  : f.timed ? <Clock className="h-4 w-4" />
                  : <Plus className="h-4 w-4" />}
                {editId ? 'Save' : f.timed ? 'Log time' : 'Add'}
              </button>
              <button type="button" onClick={cancel} className="btn-secondary text-sm">Cancel</button>
            </div>
          </div>

          {f.timed && !f.amount && (
            <p className="text-xs text-gray-500">
              No rate yet — it is still logged, and stays outstanding until it has one rather
              than being claimed at nothing. Set it once under Rates and every tap prices itself.
            </p>
          )}
        </div>
      )}

      {charges.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          Nothing yet — the correspondant&apos;s fee usually goes on when the file opens, and a
          call or an email is two taps.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {charges.map(c => {
            const timed = c.minutes != null
            const unpriced = timed && !(c.unit_amount > 0)
            const meta = [
              // Who did it. On a bare "Phone call" that is the only thing identifying it,
              // and an attendance has said it all along.
              timed ? c.creator_label : null,
              // The kind is already the headline when nothing was typed about it — do not
              // print it twice.
              c.description ? chargeKindLabel(c.kind) : null,
              formatDate(c.incurred_on),
              c.start_time && c.end_time ? `${c.start_time.slice(0, 5)}–${c.end_time.slice(0, 5)}` : null,
              timed ? formatMinutes(c.minutes as number) : null,
              // Say what a quantity meant, so a bare "2" is never left to memory.
              !timed && c.qty !== 1 ? `${c.qty} × ${money(c.unit_amount)}` : null,
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
                  title={timed && c.unit_amount > 0 ? `${money(c.unit_amount)} ${c.currency} per hour` : undefined}>
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
  const base = rateDefaultFor(kase, RATE_DEFAULT_KEY)
  const [f, setF] = useState({
    call: call ? String(call.rate) : '',
    email: email ? String(email.rate) : '',
    // Seeded rather than blank: a case with nothing set still bills at the house rate, so
    // showing an empty box here would misrepresent what the next entry will cost.
    base: String((base ?? { rate: STARTING_HOURLY_RATE }).rate),
    currency: call?.currency ?? email?.currency ?? base?.currency ?? 'USD',
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
    put(RATE_DEFAULT_KEY, f.base)

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
        and everything else starts at the default — so the rate is typed once instead of on
        every line.
      </p>
      <div className="flex flex-wrap gap-3">
        <div className="w-36">
          <label className="label-base" htmlFor="cr-base">Default / hour</label>
          <input id="cr-base" type="number" min="0" step="0.01" inputMode="decimal"
            className="input-base text-right tnum" value={f.base}
            onChange={e => setF(p => ({ ...p, base: e.target.value }))} />
        </div>
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
