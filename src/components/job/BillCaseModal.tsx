'use client'

// "Close off billing" on a P&I case.
//
// You pick a cutoff date, price each outstanding attendance — the rate belongs to the
// WORK, so the same surveyor can bill a call-out and expert-witness testimony at
// different rates in different currencies — and bill one currency at a time.
//
// ONE INVOICE, ONE CURRENCY, never converted. There is no FX anywhere in this app by
// policy. So a case with TTD hours and USD testimony bills as two invoices: you bill
// one group now and the other stays outstanding for its own run. There is deliberately
// no control here that could produce a mixed invoice, and bill_case_items re-checks it
// in the database anyway.
//
// Rates are typed here, at billing time, and are admin-only — a surveyor must never see
// the margin on their own hour.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import {
  listCaseAttendances, listCaseCharges, setAttendancePrice, billCaseRun, billingPosition,
  CURRENCIES, CASE_CHARGE_KIND,
  type CaseAttendance, type CaseCharge,
} from '@/lib/jobs/caseBilling'
import type { CaseRow } from '@/lib/jobs/cases'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Local, unsaved price edits. Persisted only when you bill, so the totals update as
 *  you type without a write per keystroke. */
type PriceEdit = { description: string; rate: string; currency: string }

export default function BillCaseModal({ open, onClose, row, onBilled }: {
  open: boolean
  onClose: () => void
  row: CaseRow | null
  onBilled: () => void
}) {
  // Trinidad's today, never the host's — Vercel runs in UTC and would offer a cutoff of
  // "tomorrow" for four hours every evening.
  const [cutoff, setCutoff] = useState(todayKey())
  const [attendances, setAttendances] = useState<CaseAttendance[] | null>(null)
  const [charges, setCharges] = useState<CaseCharge[]>([])
  const [edits, setEdits] = useState<Record<string, PriceEdit>>({})
  const [picked, setPicked] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!row) return
    setAttendances(null)
    const [a, c] = await Promise.all([listCaseAttendances(row.id), listCaseCharges(row.id)])
    setAttendances(a)
    setCharges(c)
    setEdits(Object.fromEntries(a.map(x => [x.id, {
      description: x.description ?? '',
      rate: x.charge_rate == null ? '' : String(x.charge_rate),
      currency: x.charge_currency,
    }])))
    setPicked(null)
  }, [row])

  useEffect(() => {
    if (!open || !row) return
    setCutoff(todayKey())
    load()
  }, [open, row, load])

  /** The attendances as they'd be with the current unsaved edits applied. */
  const edited = useMemo<CaseAttendance[]>(() => (attendances ?? []).map(a => {
    const e = edits[a.id]
    if (!e) return a
    const rate = e.rate.trim() === '' ? null : Number(e.rate)
    return {
      ...a,
      description: e.description.trim() || null,
      charge_rate: rate == null || Number.isNaN(rate) ? null : rate,
      charge_currency: e.currency,
    }
  }), [attendances, edits])

  const position = useMemo(() => billingPosition(edited, charges, cutoff), [edited, charges, cutoff])
  const group = position.groups.find(g => g.currency === picked) ?? position.groups[0] ?? null

  const setEdit = (id: string, patch: Partial<PriceEdit>) =>
    setEdits(p => ({ ...p, [id]: { ...(p[id] ?? { description: '', rate: '', currency: 'TTD' }), ...patch } }))

  async function submit() {
    if (!row || !group) return
    setSaving(true)

    // Persist every price first: the invoice lines are built from these, and
    // bill_case_items will only stamp entries that actually carry a rate.
    for (const a of group.attendances) {
      const e = edits[a.id]
      if (!e) continue
      const res = await setAttendancePrice(a.id, a.kind, {
        description: e.description.trim() || null,
        charge_rate: Number(e.rate) || 0,
        charge_currency: e.currency,
      })
      if (res.error) { setSaving(false); toast.error(res.error); return }
    }

    const res = await billCaseRun({
      caseId: row.id,
      clientId: row.client_id,
      currency: group.currency,
      cutoff,
      group,
      caseLabel: row.vessel_name || row.title || 'P&I case',
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(`Invoice ${res.invoiceNumber ?? 'created'} — ${res.stamped} item${res.stamped === 1 ? '' : 's'} billed`)
    onBilled()
    onClose()
  }

  const others = position.groups.filter(g => g.currency !== group?.currency)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Close off billing — ${row?.vessel_name || row?.title || 'case'}`}
      size="xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !group || group.total <= 0} className="btn-primary text-sm">
            {saving ? 'Billing…' : group ? `Bill ${money(group.total)} ${group.currency}` : 'Nothing to bill'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label-base" htmlFor="bill-cutoff">Bill everything up to</label>
          <input
            id="bill-cutoff" type="date" className="input-base w-auto" value={cutoff}
            onChange={e => setCutoff(e.target.value)}
          />
        </div>

        {attendances === null ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}</div>
        ) : (
          <>
            {/* Every outstanding attendance, priced individually. The rate belongs to the
                work, so two rows for the same person can differ. */}
            {position.groups.length === 0 && position.unpriced.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nothing is outstanding on or before {formatDate(cutoff)}. Anything logged after that date
                stays outstanding for the next invoice.
              </p>
            ) : (
              <div className="space-y-2">
                <h3 className="section-title text-sm">Outstanding work</h3>
                <div className="card divide-y divide-gray-100">
                  {edited
                    .filter(a => !a.billed_invoice_id && (!a.entry_date || a.entry_date.slice(0, 10) <= cutoff))
                    .map(a => {
                      const e = edits[a.id] ?? { description: '', rate: '', currency: 'TTD' }
                      const amount = a.hours * (a.charge_rate ?? 0)
                      const inGroup = a.charge_rate != null && a.charge_currency === group?.currency
                      return (
                        <div key={a.id} className={`flex flex-wrap items-end gap-2 px-3 py-2 ${a.charge_rate == null ? 'bg-amber-50/60' : inGroup ? '' : 'opacity-60'}`}>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {a.surveyor_name} <span className="text-gray-400 font-normal tnum">· {a.hours}h{a.kind === 'overtime' ? ' OT' : ''}</span>
                            </p>
                            <p className="text-xs text-gray-500 tnum">{a.entry_date ? formatDate(a.entry_date) : 'no date'}{a.location ? ` · ${a.location}` : ''}</p>
                          </div>
                          <input
                            aria-label="What this work was" placeholder="e.g. Expert witness testimony"
                            className="input-base py-1 px-2 text-xs w-full sm:w-52"
                            value={e.description} onChange={ev => setEdit(a.id, { description: ev.target.value })}
                          />
                          <input
                            aria-label="Rate per hour" type="number" min="0" step="0.01" inputMode="decimal"
                            placeholder="Rate" className="input-base py-1 px-2 text-xs text-right tnum w-24"
                            value={e.rate} onChange={ev => setEdit(a.id, { rate: ev.target.value })}
                          />
                          <select
                            aria-label="Currency" className="input-base py-1 px-2 text-xs w-20"
                            value={e.currency} onChange={ev => setEdit(a.id, { currency: ev.target.value })}
                          >
                            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <span className="w-24 text-right text-sm text-gray-900 tnum">{money(amount)}</span>
                        </div>
                      )
                    })}
                </div>
                {position.unpriced.length > 0 && (
                  <p className="text-xs text-amber-700">
                    {position.unpriced.length} attendance{position.unpriced.length === 1 ? '' : 's'} still need a rate.
                    Those stay outstanding — an hour with no rate is never billed at zero.
                  </p>
                )}
              </div>
            )}

            {/* Fixed fees and contractor costs ride on the same invoice. */}
            {group && group.charges.length > 0 && (
              <div className="space-y-2">
                <h3 className="section-title text-sm">Fees and costs</h3>
                <div className="card divide-y divide-gray-100">
                  {group.charges.map(c => (
                    <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-900 truncate">{c.description}{c.payee ? ` — ${c.payee}` : ''}</p>
                        <p className="text-xs text-gray-500">{CASE_CHARGE_KIND[c.kind]} · {formatDate(c.incurred_on)}</p>
                      </div>
                      <span className="text-sm text-gray-900 tnum">{money(c.qty * c.unit_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* One currency at a time. Anything else stays outstanding for its own run. */}
            {position.groups.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {position.groups.map(g => (
                  <button
                    key={g.currency} type="button" onClick={() => setPicked(g.currency)}
                    aria-pressed={g.currency === group?.currency}
                    className={`text-sm px-3 py-1 rounded-full border transition-colors tnum ${
                      g.currency === group?.currency
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
                  >
                    {g.currency} {money(g.total)}
                  </button>
                ))}
              </div>
            )}

            {others.length > 0 && (
              <p className="text-xs text-gray-500">
                {others.map(g => `${g.currency} ${money(g.total)}`).join(' and ')} stays outstanding —
                bill {others.length === 1 ? 'it' : 'them'} separately. One invoice can only carry one currency,
                and nothing here is ever converted.
              </p>
            )}

            <p className="text-xs text-gray-500">
              The case stays open. Anything logged after {formatDate(cutoff)} — and anything added later
              but dated on or before it — stays outstanding and goes on the next invoice.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}
