'use client'

// Overtime report — how much overtime each surveyor did and earned, filterable by
// month/year. Bucketed by each job's scheduled date. Reached from the Insights
// "Overtime jobs" KPI. Admin-only route.

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Clock, ChevronRight } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import { money } from '@/lib/jobs/tracker'
import { formatDate } from '@/lib/utils'
import { availableYears, inYearMonth, type YearSel, type MonthSel } from '@/lib/jobs/view'
import { listOvertimeWork, type OvertimeLine } from '@/lib/jobs/overtime'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Sum a list of {currency, amount}-ish into a currency→amount map, then to entries.
function payByCurrency(lines: OvertimeLine[]): { currency: string; amount: number }[] {
  const m = new Map<string, number>()
  for (const l of lines) if (l.overtime_pay) m.set(l.currency, (m.get(l.currency) ?? 0) + l.overtime_pay)
  return [...m.entries()].map(([currency, amount]) => ({ currency, amount }))
}

export default function OvertimePage() {
  const [lines, setLines] = useState<OvertimeLine[] | null>(null)
  const [year, setYear] = useState<YearSel>('all')
  const [month, setMonth] = useState<MonthSel>('all')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    listOvertimeWork().then(rows => {
      setLines(rows)
      const ys = availableYears(rows, r => r.date)
      if (ys.length) setYear(ys[0]) // default to the most recent year
    })
  }, [])

  const years = useMemo(() => availableYears(lines ?? [], r => r.date), [lines])
  const filtered = useMemo(() => (lines ?? []).filter(l => inYearMonth(l.date, year, month)), [lines, year, month])

  // Per-surveyor aggregate, sorted by overtime hours desc.
  const bySurveyor = useMemo(() => {
    const m = new Map<string, { id: string; name: string; jobs: Set<string>; hours: number; rows: OvertimeLine[] }>()
    for (const l of filtered) {
      let e = m.get(l.surveyor_id)
      if (!e) { e = { id: l.surveyor_id, name: l.name, jobs: new Set(), hours: 0, rows: [] }; m.set(l.surveyor_id, e) }
      e.jobs.add(l.job_id); e.hours += l.overtime_hours; e.rows.push(l)
    }
    return [...m.values()].sort((a, b) => b.hours - a.hours)
  }, [filtered])

  const totalHours = filtered.reduce((s, l) => s + l.overtime_hours, 0)
  const totalPay = payByCurrency(filtered)
  const periodLabel = `${month === 'all' ? 'All months' : MONTHS[month]} ${year === 'all' ? '(all years)' : year}`

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-rise">
      <PageHeader icon={Clock} title="Overtime" subtitle="Overtime worked and earned per surveyor — filter by month." />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={String(year)} onChange={e => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))} className="input-base text-sm w-auto py-1.5">
          <option value="all">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={String(month)} onChange={e => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value) as MonthSel)} className="input-base text-sm w-auto py-1.5">
          <option value="all">All months</option>
          {MONTHS.map((mn, i) => <option key={mn} value={i}>{mn}</option>)}
        </select>
        {(year !== 'all' || month !== 'all') && (
          <button onClick={() => { setYear('all'); setMonth('all') }} className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1.5">Clear</button>
        )}
      </div>

      {!lines ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton h-24" />)}</div>
      ) : (
        <>
          {/* Period totals */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="card p-4"><p className="text-xs text-gray-400">Overtime hours · {periodLabel}</p><p className="text-2xl font-semibold text-gray-900 tnum mt-1">{totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</p></div>
            <div className="card p-4"><p className="text-xs text-gray-400">Surveyors with OT</p><p className="text-2xl font-semibold text-gray-900 tnum mt-1">{bySurveyor.length}</p></div>
            <div className="card p-4"><p className="text-xs text-gray-400">Overtime pay</p>
              {totalPay.length === 0 ? <p className="text-2xl font-semibold text-gray-300 mt-1">—</p>
                : <div className="mt-1 space-y-0.5">{totalPay.map(p => <p key={p.currency} className="text-lg font-semibold text-gray-900 tnum">{money(p.amount, p.currency)}</p>)}</div>}
            </div>
          </div>

          {/* Per-surveyor */}
          {bySurveyor.length === 0 ? (
            <div className="card p-8 text-center text-sm text-gray-400">No overtime logged for {periodLabel}.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                  <th className="font-medium px-4 py-2.5">Surveyor</th>
                  <th className="font-medium px-4 py-2.5 text-right">OT jobs</th>
                  <th className="font-medium px-4 py-2.5 text-right">OT hours</th>
                  <th className="font-medium px-4 py-2.5 text-right">OT pay</th>
                  <th className="w-8" />
                </tr></thead>
                <tbody>
                  {bySurveyor.map(s => {
                    const pay = payByCurrency(s.rows)
                    const isOpen = open === s.id
                    return (
                      <Fragment key={s.id}>
                        <tr onClick={() => setOpen(isOpen ? null : s.id)} className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-900 font-medium">{s.name}</td>
                          <td className="px-4 py-3 text-right tnum text-gray-600">{s.jobs.size}</td>
                          <td className="px-4 py-3 text-right tnum font-medium text-gray-900">{s.hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                          <td className="px-4 py-3 text-right">
                            {pay.length === 0 ? <span className="text-gray-300">—</span>
                              : <div className="flex flex-col items-end gap-0.5">{pay.map(p => <span key={p.currency} className="tnum text-gray-700">{money(p.amount, p.currency)}</span>)}</div>}
                          </td>
                          <td className="px-2 text-gray-300"><ChevronRight className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} /></td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-gray-50/60">
                            <td colSpan={5} className="px-4 py-3">
                              <div className="space-y-1.5">
                                {s.rows.slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).map((l, i) => (
                                  <div key={l.job_id + i} className="flex items-center gap-3 text-xs">
                                    <span className="tnum text-gray-500 w-20">{l.date ? formatDate(l.date) : '—'}</span>
                                    <Link href={`/admin/jobs/${l.job_id}`} className="text-brand-700 hover:underline truncate flex-1">{l.vessel_name ? `M.V. ${l.vessel_name}` : l.job_title}{l.report_number ? ` · ${l.report_number}` : ''}</Link>
                                    <span className="tnum font-medium text-gray-800">{l.overtime_hours}h</span>
                                    <span className="tnum text-gray-600 w-24 text-right">{l.overtime_pay ? money(l.overtime_pay, l.currency) : '—'}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-400">Overtime pay needs each surveyor&apos;s OT rate set on the job (Surveyors &amp; hours). Multi-day jobs count under their start month.</p>
        </>
      )}
    </div>
  )
}
