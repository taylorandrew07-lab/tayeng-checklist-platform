'use client'

// "Close off billing" on a P&I case.
//
// You pick a cutoff date; every attendance dated on or before it that has not already
// been paid for goes on one invoice, one line per surveyor at the rate you set for
// them. The case stays open and keeps accruing — the next run picks up from where
// this one stopped, however many months later that is.
//
// The rate here is what the CLIENT is charged, not what the surveyor is paid. It
// lives in an admin-only table (mig 206) precisely so it is never visible to the
// person whose hour it prices.

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import { caseSurveyorTotals, setCaseChargeRate, billCase, type CaseSurveyorTotals } from '@/lib/jobs/caseBilling'
import type { CaseRow } from '@/lib/jobs/cases'

const CURRENCIES = ['TTD', 'USD', 'EUR', 'GBP']
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function BillCaseModal({ open, onClose, row, onBilled }: {
  open: boolean
  onClose: () => void
  row: CaseRow | null
  onBilled: () => void
}) {
  // Trinidad's today, never the host's — Vercel runs in UTC and would offer a cutoff
  // of "tomorrow" for four hours every evening.
  const [cutoff, setCutoff] = useState(todayKey())
  const [totals, setTotals] = useState<CaseSurveyorTotals[] | null>(null)
  const [rates, setRates] = useState<Record<string, string>>({})
  const [currency, setCurrency] = useState('TTD')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (upTo: string) => {
    if (!row) return
    setTotals(null)
    const t = await caseSurveyorTotals(row.id, upTo)
    setTotals(t)
    setRates(Object.fromEntries(t.map(s => [s.job_surveyor_id, s.charge_rate == null ? '' : String(s.charge_rate)])))
    const withCcy = t.find(s => s.charge_rate != null)
    if (withCcy) setCurrency(withCcy.charge_currency)
  }, [row])

  useEffect(() => {
    if (!open || !row) return
    setCutoff(todayKey())
    load(todayKey())
  }, [open, row, load])

  const lines = (totals ?? []).map(s => ({
    job_surveyor_id: s.job_surveyor_id,
    surveyor_name: s.surveyor_name,
    qty: s.outstanding,
    unit_price: Number(rates[s.job_surveyor_id] ?? '') || 0,
  }))
  const billable = lines.filter(l => l.qty > 0)
  const total = billable.reduce((sum, l) => sum + l.qty * l.unit_price, 0)
  const missingRate = billable.some(l => l.unit_price <= 0)

  async function submit() {
    if (!row) return
    if (!billable.length) { toast.error('Nothing is outstanding up to that date.'); return }
    setSaving(true)

    // Remember the rates so the next billing run defaults to them.
    for (const l of billable) {
      await setCaseChargeRate(l.job_surveyor_id, l.unit_price, currency)
    }

    const res = await billCase({
      caseId: row.id,
      clientId: row.client_id,
      currency,
      cutoff,
      lines: billable,
      caseLabel: row.vessel_name || row.title || 'P&I case',
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success(
      `Invoice ${res.invoiceNumber ?? 'created'} — ${res.stamped} attendance${res.stamped === 1 ? '' : 's'} billed`,
    )
    onBilled()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Close off billing — ${row?.vessel_name || row?.title || 'case'}`}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={submit} disabled={saving || !billable.length} className="btn-primary text-sm">
            {saving ? 'Billing…' : `Bill ${money(total)} ${currency}`}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label-base" htmlFor="bill-cutoff">Bill everything up to</label>
            <input
              id="bill-cutoff" type="date" className="input-base" value={cutoff}
              onChange={e => { setCutoff(e.target.value); load(e.target.value) }}
            />
          </div>
          <div>
            <label className="label-base" htmlFor="bill-ccy">Currency</label>
            <select id="bill-ccy" className="input-base" value={currency} onChange={e => setCurrency(e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {totals === null ? (
          <div className="space-y-2">
            {[0, 1].map(i => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}
          </div>
        ) : billable.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nothing is outstanding on or before {formatDate(cutoff)}. Anything logged after that date
            stays outstanding for the next invoice.
          </p>
        ) : (
          <div className="card divide-y divide-gray-100">
            {billable.map(l => {
              const t = totals.find(x => x.job_surveyor_id === l.job_surveyor_id)!
              return (
                <div key={l.job_surveyor_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{l.surveyor_name}</p>
                    <p className="text-xs text-gray-500 tnum">
                      {l.qty} outstanding
                      {t.billed > 0 && <span className="text-gray-400"> · {t.billed} already billed</span>}
                    </p>
                  </div>
                  <div className="w-28">
                    <label className="sr-only" htmlFor={`rate-${l.job_surveyor_id}`}>
                      Rate for {l.surveyor_name}
                    </label>
                    <input
                      id={`rate-${l.job_surveyor_id}`}
                      type="number" min="0" step="0.01" inputMode="decimal"
                      className="input-base text-right tnum" placeholder="Rate"
                      value={rates[l.job_surveyor_id] ?? ''}
                      onChange={e => setRates(p => ({ ...p, [l.job_surveyor_id]: e.target.value }))}
                    />
                  </div>
                  <div className="w-24 text-right text-sm text-gray-900 tnum">
                    {money(l.qty * l.unit_price)}
                  </div>
                </div>
              )
            })}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
              <span className="text-sm font-medium text-gray-700">Total</span>
              <span className="text-sm font-semibold text-gray-900 tnum">{money(total)} {currency}</span>
            </div>
          </div>
        )}

        {missingRate && (
          <p className="text-sm text-amber-700">
            One or more surveyors have no rate set — those lines would bill at zero.
          </p>
        )}

        <p className="text-xs text-gray-500">
          The case stays open. Anything logged after {formatDate(cutoff)} — and anything added later
          but dated on or before it — stays outstanding and goes on the next invoice.
        </p>
      </div>
    </Modal>
  )
}
