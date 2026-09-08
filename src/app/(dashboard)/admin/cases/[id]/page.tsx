'use client'

// One P&I case.
//
// A case IS a job, and the ordinary job page still owns everything a job does — the
// checklist, the files, and the per-surveyor time logs where hours are actually
// entered. This page owns what is true only of a CASE and has nowhere else to live:
// its life-cycle, its fixed fees and contractor costs, and its billing position split
// by currency.
//
// It deliberately does NOT re-implement JobOpsPanel. "Log hours" sends you to the job
// page, because duplicating that panel would mean two places to enter a shift and two
// places for it to be wrong.

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Scale, Receipt, Plus, Trash2, Briefcase, ExternalLink } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { formatDate } from '@/lib/utils'
import { todayKey } from '@/lib/cargo/voyageDate'
import { listCases, setCaseStatus, caseDaysOpen, CASE_STATUS, CASE_STATUS_ORDER, type CaseRow, type CaseStatus } from '@/lib/jobs/cases'
import {
  listCaseAttendances, listCaseCharges, addCaseCharge, deleteCaseCharge, billingPosition,
  CURRENCIES, CASE_CHARGE_KIND,
  type CaseAttendance, type CaseCharge, type CaseChargeKind,
} from '@/lib/jobs/caseBilling'
import BillCaseModal from '@/components/job/BillCaseModal'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CasePage() {
  const params = useParams()
  const caseId = String(params?.id ?? '')

  const [row, setRow] = useState<CaseRow | null | undefined>(undefined)
  const [attendances, setAttendances] = useState<CaseAttendance[]>([])
  const [charges, setCharges] = useState<CaseCharge[]>([])
  const [billing, setBilling] = useState(false)

  const load = useCallback(async () => {
    if (!caseId) return
    const [cases, a, c] = await Promise.all([listCases(), listCaseAttendances(caseId), listCaseCharges(caseId)])
    setRow(cases.find(x => x.id === caseId) ?? null)
    setAttendances(a)
    setCharges(c)
  }, [caseId])

  useEffect(() => { load() }, [load])

  // No cutoff: this is the case's whole position, not a run about to happen.
  const position = useMemo(() => billingPosition(attendances, charges, null), [attendances, charges])

  async function changeStatus(next: CaseStatus) {
    if (!row) return
    const res = await setCaseStatus(row.id, next)
    if (res.error) { toast.error(res.error); return }
    toast.success(`Case marked ${CASE_STATUS[next].label.toLowerCase()}`)
    load()
  }

  if (row === undefined) {
    return <div className="max-w-7xl mx-auto space-y-4"><div className="skeleton h-24 w-full rounded-xl" /><div className="skeleton h-64 w-full rounded-xl" /></div>
  }
  if (row === null) {
    return (
      <div className="max-w-7xl mx-auto">
        <EmptyState icon={Scale} title="Case not found" description="It may have been deleted, or it is not a P&I case."
          action={<Link href="/admin" className="btn-primary text-sm">Back to cases</Link>} />
      </div>
    )
  }

  const days = caseDaysOpen(row)
  const meta = CASE_STATUS[row.case_status]

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader
        icon={Scale}
        title={row.vessel_name || row.title || 'Case'}
        subtitle={[row.client_name ?? 'No client', days === null ? null : `open ${days} day${days === 1 ? '' : 's'}`]
          .filter(Boolean).join(' · ')}
        back={{ href: '/admin', label: 'P&I Cases' }}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/admin/jobs/${row.id}`} className="btn-secondary text-sm" title="Hours, files and the checklist live on the job page">
              <Briefcase className="h-4 w-4" /><span className="hidden sm:inline">Job page</span>
            </Link>
            <button type="button" onClick={() => setBilling(true)} className="btn-primary text-sm">
              <Receipt className="h-4 w-4" />Bill
            </button>
          </div>
        }
      />

      {/* Life-cycle. A case stays open for years; concluding it is what finally lets it
          lock like any other job (mig 204). */}
      <div className="card p-5 flex flex-wrap items-center gap-3">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.pill}`}>{meta.label}</span>
        <div className="flex flex-wrap gap-2">
          {CASE_STATUS_ORDER.filter(s => s !== row.case_status).map(s => (
            <button key={s} type="button" onClick={() => changeStatus(s)} className="btn-ghost text-xs">
              Mark {CASE_STATUS[s].label.toLowerCase()}
            </button>
          ))}
        </div>
        {row.case_status === 'concluded' && (
          <p className="text-xs text-gray-500 w-full">
            A concluded case locks like any other billed job — surveyors can no longer log against it.
          </p>
        )}
      </div>

      {/* The money position, split by currency because one invoice can only carry one. */}
      <div className="card">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="section-title">Billing position</h2>
        </div>
        <div className="px-6 py-4 grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-gray-500">Outstanding</p>
            {position.groups.length === 0 ? (
              <p className="text-sm text-gray-400">Nothing outstanding</p>
            ) : position.groups.map(g => (
              <p key={g.currency} className="text-sm text-gray-900 tnum">{money(g.total)} {g.currency}</p>
            ))}
            {position.unpriced.length > 0 && (
              <p className="text-xs text-amber-700 mt-1">
                {position.unpriced.length} attendance{position.unpriced.length === 1 ? '' : 's'} not yet priced
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-gray-500">Billed to date</p>
            {Object.keys(position.billedTotal).length === 0 ? (
              <p className="text-sm text-gray-400">Nothing billed yet</p>
            ) : Object.entries(position.billedTotal).map(([ccy, amt]) => (
              <p key={ccy} className="text-sm text-gray-900 tnum">{money(amt)} {ccy}</p>
            ))}
          </div>
        </div>
      </div>

      <ChargesCard jobId={row.id} charges={charges} onChanged={load} />

      {/* Read-only here: hours are entered on the job page, and two places to enter a
          shift is two places for it to be wrong. */}
      <div className="card">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
          <h2 className="section-title">Attendances</h2>
          <Link href={`/admin/jobs/${row.id}`} className="text-sm text-brand-600 hover:text-brand-800 font-medium">
            Log hours on the job page <ExternalLink className="inline h-3 w-3" />
          </Link>
        </div>
        {attendances.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">No attendances logged yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {attendances.slice(0, 20).map(a => (
              <div key={a.id} className="flex items-center gap-4 px-6 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-gray-900 truncate">
                    {a.surveyor_name}
                    {a.description && <span className="text-gray-500"> · {a.description}</span>}
                  </p>
                  <p className="text-xs text-gray-500 tnum">
                    {a.entry_date ? formatDate(a.entry_date) : 'no date'}{a.location ? ` · ${a.location}` : ''}
                  </p>
                </div>
                <span className="text-sm text-gray-900 tnum flex-shrink-0">{a.hours}h</span>
                <span className="text-xs flex-shrink-0 w-32 text-right">
                  {a.billed_invoice_id
                    ? <span className="text-gray-400">billed {a.billed_invoice_number ?? ''}</span>
                    : a.charge_rate == null
                      ? <span className="text-amber-700">no rate</span>
                      : <span className="text-gray-600 tnum">{money(a.hours * a.charge_rate)} {a.charge_currency}</span>}
                </span>
              </div>
            ))}
            {attendances.length > 20 && (
              <p className="px-6 py-2.5 text-xs text-gray-500">and {attendances.length - 20} more…</p>
            )}
          </div>
        )}
      </div>

      <BillCaseModal open={billing} row={row} onClose={() => setBilling(false)} onBilled={load} />
    </div>
  )
}

/** Fixed fees and third-party costs. Same shape, one table (mig 208): a dated one-time
 *  amount in a currency, optionally with a receipt. */
function ChargesCard({ jobId, charges, onChanged }: {
  jobId: string
  charges: CaseCharge[]
  onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<CaseChargeKind>('correspondency')
  const [description, setDescription] = useState('')
  const [payee, setPayee] = useState('')
  const [on, setOn] = useState(todayKey())
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('TTD')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!description.trim()) { toast.error('Give the charge a description'); return }
    const amt = Number(amount)
    if (!(amt > 0)) { toast.error('Enter an amount'); return }
    setBusy(true)
    const res = await addCaseCharge({
      jobId, kind, description: description.trim(), payee: payee.trim() || null,
      incurred_on: on, qty: 1, unit_amount: amt, currency,
    })
    setBusy(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('Charge added')
    setDescription(''); setPayee(''); setAmount(''); setAdding(false)
    onChanged()
  }

  async function remove(c: CaseCharge) {
    if (!(await confirmDialog({
      title: 'Delete this charge?',
      message: `${c.description} — ${money(c.qty * c.unit_amount)} ${c.currency}`,
      confirmLabel: 'Delete', danger: true,
    }))) return
    const res = await deleteCaseCharge(c.id)
    if (res.error) { toast.error(res.error); return }
    onChanged()
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200">
        <h2 className="section-title">Fees and costs</h2>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="btn-secondary text-xs">
            <Plus className="h-4 w-4" />Add charge
          </button>
        )}
      </div>

      {adding && (
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div>
              <label className="label-base" htmlFor="cc-kind">Type</label>
              <select id="cc-kind" className="input-base w-48" value={kind} onChange={e => setKind(e.target.value as CaseChargeKind)}>
                {(Object.keys(CASE_CHARGE_KIND) as CaseChargeKind[]).map(k => (
                  <option key={k} value={k}>{CASE_CHARGE_KIND[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-base" htmlFor="cc-on">Date</label>
              <input id="cc-on" type="date" className="input-base w-40" value={on} onChange={e => setOn(e.target.value)} />
            </div>
            <div>
              <label className="label-base" htmlFor="cc-amt">Amount</label>
              <input id="cc-amt" type="number" min="0" step="0.01" inputMode="decimal" className="input-base w-32 text-right tnum"
                value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div>
              <label className="label-base" htmlFor="cc-ccy">Currency</label>
              <select id="cc-ccy" className="input-base w-24" value={currency} onChange={e => setCurrency(e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <label className="label-base" htmlFor="cc-desc">Description</label>
              <input id="cc-desc" className="input-base" value={description} onChange={e => setDescription(e.target.value)}
                placeholder={kind === 'correspondency' ? 'Correspondency fee' : 'e.g. Launch hire'} />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="label-base" htmlFor="cc-payee">Paid to (optional)</label>
              <input id="cc-payee" className="input-base" value={payee} onChange={e => setPayee(e.target.value)}
                placeholder="Contractor or supplier" />
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="btn-primary text-sm">{busy ? 'Adding…' : 'Add charge'}</button>
            <button type="button" onClick={() => setAdding(false)} className="btn-secondary text-sm">Cancel</button>
          </div>
        </div>
      )}

      {charges.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-gray-400">
          No fees or costs yet — add the correspondency fee when the case opens.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {charges.map(c => (
            <div key={c.id} className="flex items-center gap-4 px-6 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-900 truncate">{c.description}{c.payee ? ` — ${c.payee}` : ''}</p>
                <p className="text-xs text-gray-500">{CASE_CHARGE_KIND[c.kind]} · {formatDate(c.incurred_on)}</p>
              </div>
              <span className="text-sm text-gray-900 tnum flex-shrink-0">{money(c.qty * c.unit_amount)} {c.currency}</span>
              <span className="text-xs w-28 text-right flex-shrink-0">
                {c.billed_invoice_id
                  ? <span className="text-gray-400">billed {c.billed_invoice_number ?? ''}</span>
                  : <span className="text-brand-700">outstanding</span>}
              </span>
              {!c.billed_invoice_id && (
                <button type="button" onClick={() => remove(c)} aria-label="Delete this charge"
                  className="btn-ghost p-1 text-gray-400 hover:text-red-600 flex-shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
