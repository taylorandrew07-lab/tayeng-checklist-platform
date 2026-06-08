'use client'

import { Fragment, useState } from 'react'
import { type Voyage, type ReadingType, PERIODS, PERIOD_LABELS, readingTypeAppliesToHold, isSinglePoint, getReadingValue } from '@/lib/cargo/types'
import { readingCellColor } from '@/lib/cargo/colors'
import { monitoringDates, formatVoyageDate, holdNumbers } from '@/lib/cargo/periods'

/** Read-only readings table for clients (Hold + Date; points × periods; colours). */
export default function ClientReadingsView({ voyage }: { voyage: Voyage }) {
  const dates = monitoringDates(voyage.startDate, voyage.endDate)
  const holds = holdNumbers(voyage.holdCount)
  const [hold, setHold] = useState(holds[0] ?? 1)
  const [date, setDate] = useState(dates[0] ?? '')

  const types = voyage.readingTypes.filter(rt => rt.includeInTables && readingTypeAppliesToHold(rt, hold))

  if (dates.length === 0 || types.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No readings to display.</p>
  }

  const cell = (rtId: string, ptId: string, rt: ReadingType) => (
    PERIODS.map(p => {
      const v = getReadingValue(voyage, date, p, hold, rtId, ptId)
      const c = readingCellColor(voyage, rt, hold, date, p, ptId)
      return (
        <td key={p} className="px-2 py-1.5 text-center text-sm" style={c ? { backgroundColor: c.bg, color: c.fg } : undefined}>
          {v || '—'}
        </td>
      )
    })
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label-base">Hold</label>
          <select className="input-base" value={hold} onChange={e => setHold(Number(e.target.value))}>
            {holds.map(h => <option key={h} value={h}>Hold {h}</option>)}
          </select>
        </div>
        <div>
          <label className="label-base">Date</label>
          <select className="input-base" value={date} onChange={e => setDate(e.target.value)}>
            {dates.map(d => <option key={d} value={d}>{formatVoyageDate(d)}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-3 py-2 font-semibold text-gray-600 min-w-[150px]">Reading</th>
              {PERIODS.map(p => <th key={p} className="px-2 py-2 font-semibold text-gray-600 text-center min-w-[80px]">{PERIOD_LABELS[p]}</th>)}
            </tr>
            <tr className="border-b border-gray-200">
              <th className="text-right px-3 py-1 text-xs font-medium text-gray-400">Actual time</th>
              {PERIODS.map(p => <th key={p} className="px-2 py-1 text-xs font-normal text-gray-400 text-center">{voyage.periodMeta?.[date]?.[p]?.actualTime || '—'}</th>)}
            </tr>
          </thead>
          <tbody>
            {types.map(rt => {
              if (isSinglePoint(rt)) {
                return (
                  <tr key={rt.id} className="border-b border-gray-100">
                    <td className="px-3 py-1.5 font-medium text-gray-700">{rt.name}{rt.unit ? <span className="text-gray-400 font-normal"> ({rt.unit})</span> : null}</td>
                    {cell(rt.id, rt.points[0].id, rt)}
                  </tr>
                )
              }
              return (
                <Fragment key={rt.id}>
                  <tr className="bg-gray-50/70 border-b border-gray-200">
                    <td colSpan={1 + PERIODS.length} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{rt.name}{rt.unit ? ` (${rt.unit})` : ''}</td>
                  </tr>
                  {rt.points.map(pt => (
                    <tr key={pt.id} className="border-b border-gray-100">
                      <td className="px-3 py-1.5 text-gray-700">{pt.name || '—'}{pt.group ? <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">{pt.group}</span> : null}</td>
                      {cell(rt.id, pt.id, rt)}
                    </tr>
                  ))}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
