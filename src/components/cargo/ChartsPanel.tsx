'use client'

import { useMemo, useState } from 'react'
import { LineChart } from 'lucide-react'
import { type Voyage, type Period, PERIODS, PERIOD_LABELS, readingTypeAppliesToHold } from '@/lib/cargo/types'
import { monitoringDates, formatVoyageDate, holdNumbers } from '@/lib/cargo/periods'
import { buildChartModel, layoutChart, formatTick, type ChartModel } from '@/lib/cargo/charts'

interface Props {
  voyage: Voyage
  onChange: (next: Voyage) => void // unused (charts are read-only) — kept for tab uniformity
}

const W = 620, H = 240

function ChartSvg({ model }: { model: ChartModel }) {
  const L = layoutChart(model, W, H)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img">
      {L.yTicks.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={L.plot.left} y1={t.y} x2={L.plot.left + L.plot.w} y2={t.y} stroke="#e2e8f0" strokeWidth={0.5} />
          <text x={L.plot.left - 5} y={t.y + 3} fontSize={8} fill="#94a3b8" textAnchor="end">{formatTick(t.value)}</text>
        </g>
      ))}
      <line x1={L.plot.left} y1={L.baselineY} x2={L.plot.left + L.plot.w} y2={L.baselineY} stroke="#94a3b8" strokeWidth={0.5} />
      {L.xTicks.map((t, i) => (
        <text key={`x${i}`} x={t.x} y={H - 14} fontSize={8} fill="#94a3b8" textAnchor="middle">{t.label}</text>
      ))}
      {L.series.map(s => s.segments.map((seg, si) => (
        <polyline key={`${s.hold}-${si}`} points={seg.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={1.5} />
      )))}
    </svg>
  )
}

export default function ChartsPanel({ voyage }: Props) {
  const dates = useMemo(() => monitoringDates(voyage.startDate, voyage.endDate), [voyage.startDate, voyage.endDate])
  const chartTypes = voyage.readingTypes.filter(rt => rt.includeInCharts)

  const [rtId, setRtId] = useState(chartTypes[0]?.id ?? '')
  const [pointId, setPointId] = useState(chartTypes[0]?.points[0]?.id ?? '')
  const [start, setStart] = useState(dates[0] ?? '')
  const [end, setEnd] = useState(dates[dates.length - 1] ?? '')
  const [periods, setPeriods] = useState<Period[]>([...PERIODS])
  const [holdSel, setHoldSel] = useState<number[] | 'all'>('all')

  const readingType = chartTypes.find(rt => rt.id === rtId) ?? chartTypes[0]
  const multiPoint = !!readingType && !(readingType.points.length === 1 && !readingType.points[0].name)
  const point = readingType?.points.find(p => p.id === pointId) ?? readingType?.points[0]
  const applicableHolds = readingType
    ? holdNumbers(voyage.holdCount).filter(h => readingTypeAppliesToHold(readingType, h))
    : []

  function selectType(id: string) {
    setRtId(id)
    const rt = chartTypes.find(t => t.id === id)
    setPointId(rt?.points[0]?.id ?? '')
    setHoldSel('all')
  }

  const model = readingType && point
    ? buildChartModel(voyage, readingType, point, { dateRange: [start, end], periods, holds: holdSel })
    : null

  function togglePeriod(p: Period) {
    setPeriods(prev => {
      const next = prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
      return PERIODS.filter(x => next.includes(x)) // keep canonical order
    })
  }
  function toggleHold(h: number) {
    const cur = holdSel === 'all' ? [...applicableHolds] : [...holdSel]
    const next = cur.includes(h) ? cur.filter(x => x !== h) : [...cur, h].sort((a, b) => a - b)
    setHoldSel(next.length === applicableHolds.length ? 'all' : next)
  }

  if (chartTypes.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No reading types are marked &ldquo;Include in charts&rdquo;. Enable it on the Setup tab.</p>
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label-base">Reading Type</label>
            <select className="input-base" value={rtId} onChange={e => selectType(e.target.value)}>
              {chartTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}{rt.unit ? ` (${rt.unit})` : ''}</option>)}
            </select>
          </div>
          {multiPoint && readingType && (
            <div>
              <label className="label-base">Point</label>
              <select className="input-base" value={pointId} onChange={e => setPointId(e.target.value)}>
                {readingType.points.map(p => <option key={p.id} value={p.id}>{p.group ? `${p.group} · ` : ''}{p.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label-base">From</label>
            <select className="input-base" value={start} onChange={e => setStart(e.target.value)}>
              {dates.map(d => <option key={d} value={d}>{formatVoyageDate(d)}</option>)}
            </select>
          </div>
          <div>
            <label className="label-base">To</label>
            <select className="input-base" value={end} onChange={e => setEnd(e.target.value)}>
              {dates.map(d => <option key={d} value={d}>{formatVoyageDate(d)}</option>)}
            </select>
          </div>
          <div>
            <label className="label-base">Periods</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {PERIODS.map(p => (
                <button
                  key={p}
                  onClick={() => togglePeriod(p)}
                  className={`px-2 py-1 rounded text-xs font-medium border ${periods.includes(p) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                >{PERIOD_LABELS[p]}</button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="label-base">Holds</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <button
              onClick={() => setHoldSel('all')}
              className={`px-2.5 py-1 rounded text-xs font-medium border ${holdSel === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
            >All</button>
            {applicableHolds.map(h => {
              const active = holdSel !== 'all' && holdSel.includes(h)
              return (
                <button
                  key={h}
                  onClick={() => toggleHold(h)}
                  className={`px-2.5 py-1 rounded text-xs font-medium border ${active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                >{h}</button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="font-semibold text-gray-900 mb-2">
          {readingType?.name}{multiPoint && point ? ` — ${point.group ? `${point.group} · ` : ''}${point.name}` : ''}{readingType?.unit ? ` (${readingType.unit})` : ''} — trend
        </h3>
        {model && model.hasData ? (
          <>
            <ChartSvg model={model} />
            <div className="flex flex-wrap gap-3 mt-2">
              {model.series.map(s => (
                <div key={s.hold} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                  Hold {s.hold}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="py-12 text-center text-gray-400">
            <LineChart className="h-8 w-8 mx-auto mb-2 text-gray-300" />
            No readings entered for this selection yet.
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">All reading types marked &ldquo;Include in charts&rdquo; with data are added to the PDF automatically (whole voyage, all applicable holds).</p>
    </div>
  )
}
