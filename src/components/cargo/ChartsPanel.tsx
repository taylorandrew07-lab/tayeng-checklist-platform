'use client'

import { useMemo, useState } from 'react'
import { LineChart } from 'lucide-react'
import { type Voyage, type Period, PERIODS, PERIOD_LABELS, readingTypeAppliesToHold, isSinglePoint } from '@/lib/cargo/types'
import { monitoringDates, formatVoyageDate, holdNumbers } from '@/lib/cargo/periods'
import { buildHoldSeries, buildPointSeries, layoutChart, formatTick, type ChartModel, type ChartFilter } from '@/lib/cargo/charts'

interface Props {
  voyage: Voyage
  onChange: (next: Voyage) => void // unused (charts are read-only) — kept for tab uniformity
}

const ALL = '__all__'
const W = 640, H = 260

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
        <polyline key={`${s.key}-${si}`} points={seg.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={s.color} strokeWidth={1.5} />
      )))}
      {/* dot at every reading so single/isolated values always show */}
      {L.series.map(s => s.segments.flat().map((p, i) => (
        <circle key={`${s.key}-d${i}`} cx={p.x} cy={p.y} r={2.5} fill={s.color} />
      )))}
    </svg>
  )
}

function ChartCard({ title, model }: { title: string; model: ChartModel }) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
      {model.hasData ? (
        <>
          <ChartSvg model={model} />
          <div className="flex flex-wrap gap-3 mt-2">
            {model.series.map(s => (
              <div key={s.key} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                {s.label}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="py-10 text-center text-gray-400">
          <LineChart className="h-7 w-7 mx-auto mb-2 text-gray-300" />
          No readings entered for this selection yet.
        </div>
      )}
    </div>
  )
}

export default function ChartsPanel({ voyage }: Props) {
  const dates = useMemo(() => monitoringDates(voyage.startDate, voyage.endDate), [voyage.startDate, voyage.endDate])
  const chartTypes = voyage.readingTypes.filter(rt => rt.includeInCharts)
  const allHolds = holdNumbers(voyage.holdCount)

  const [rtId, setRtId] = useState(chartTypes[0]?.id ?? '')
  const [start, setStart] = useState(dates[0] ?? '')
  const [end, setEnd] = useState(dates[dates.length - 1] ?? '')
  const [periods, setPeriods] = useState<Period[]>([...PERIODS])
  const [hold, setHold] = useState(1)               // selected hold for points charts
  const [pointSel, setPointSel] = useState<'all' | string[]>('all')
  const [holdSel, setHoldSel] = useState<'all' | number[]>('all') // single-value types

  const isAll = rtId === ALL
  const readingType = isAll ? undefined : (chartTypes.find(rt => rt.id === rtId) ?? chartTypes[0])
  const multiPoint = !!readingType && !isSinglePoint(readingType)
  const applicableHolds = readingType ? allHolds.filter(h => readingTypeAppliesToHold(readingType, h)) : allHolds
  const holdOptions = isAll ? allHolds : applicableHolds
  const effectiveHold = holdOptions.includes(hold) ? hold : (holdOptions[0] ?? 1)
  // The hold picker is relevant whenever a multi-point chart is on screen.
  const showHoldPicker = isAll ? chartTypes.some(rt => !isSinglePoint(rt)) : multiPoint

  function selectType(id: string) {
    setRtId(id)
    setPointSel('all')
    setHoldSel('all')
    if (id !== ALL) {
      const rt = chartTypes.find(t => t.id === id)
      const firstHold = rt ? allHolds.filter(h => readingTypeAppliesToHold(rt, h))[0] : 1
      setHold(firstHold ?? 1)
    }
  }

  const filter: ChartFilter = { dateRange: [start, end], periods }

  function modelFor(rt: NonNullable<typeof readingType>): ChartModel {
    return isSinglePoint(rt)
      ? buildHoldSeries(voyage, rt, rt.points[0], { ...filter, holds: isAll ? 'all' : holdSel })
      : buildPointSeries(voyage, rt, effectiveHold, isAll ? 'all' : pointSel, filter)
  }

  function togglePeriod(p: Period) {
    setPeriods(prev => {
      const next = prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
      return PERIODS.filter(x => next.includes(x))
    })
  }
  function togglePoint(id: string) {
    if (!readingType) return
    const cur = pointSel === 'all' ? readingType.points.map(p => p.id) : [...pointSel]
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
    setPointSel(next.length === readingType.points.length || next.length === 0 ? 'all' : next)
  }
  function toggleHold(h: number) {
    const cur = holdSel === 'all' ? [...applicableHolds] : [...holdSel]
    const next = cur.includes(h) ? cur.filter(x => x !== h) : [...cur, h].sort((a, b) => a - b)
    setHoldSel(next.length === applicableHolds.length || next.length === 0 ? 'all' : next)
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
              <option value={ALL}>All reading types</option>
              {chartTypes.map(rt => <option key={rt.id} value={rt.id}>{rt.name}{rt.unit ? ` (${rt.unit})` : ''}</option>)}
            </select>
          </div>
          {showHoldPicker && (
            <div>
              <label className="label-base">Hold{isAll ? ' (multi-point charts)' : ''}</label>
              <select className="input-base" value={effectiveHold} onChange={e => setHold(Number(e.target.value))}>
                {holdOptions.map(h => <option key={h} value={h}>Hold {h}</option>)}
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
                <button key={p} onClick={() => togglePeriod(p)}
                  className={`px-2 py-1 rounded text-xs font-medium border ${periods.includes(p) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                >{PERIOD_LABELS[p]}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Point / hold selectors only apply to a single chosen reading type. */}
        {!isAll && multiPoint && (
          <div>
            <label className="label-base">Points</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <button onClick={() => setPointSel('all')}
                className={`px-2.5 py-1 rounded text-xs font-medium border ${pointSel === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
              >All</button>
              {readingType!.points.map(pt => {
                const active = pointSel !== 'all' && pointSel.includes(pt.id)
                return (
                  <button key={pt.id} onClick={() => togglePoint(pt.id)} title={pt.group ? `${pt.group} · ${pt.name}` : pt.name}
                    className={`px-2.5 py-1 rounded text-xs font-medium border ${active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                  >{pt.name || '—'}</button>
                )
              })}
            </div>
          </div>
        )}
        {!isAll && !multiPoint && (
          <div>
            <label className="label-base">Holds</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <button onClick={() => setHoldSel('all')}
                className={`px-2.5 py-1 rounded text-xs font-medium border ${holdSel === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
              >All</button>
              {applicableHolds.map(h => {
                const active = holdSel !== 'all' && holdSel.includes(h)
                return (
                  <button key={h} onClick={() => toggleHold(h)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border ${active ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                  >{h}</button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {isAll ? (
        chartTypes.map(rt => {
          const m = modelFor(rt)
          const title = `${rt.name}${m.subtitle ? ` — ${m.subtitle}` : ''}${rt.unit ? ` (${rt.unit})` : ''}`
          return <ChartCard key={rt.id} title={title} model={m} />
        })
      ) : readingType ? (
        (() => {
          const m = modelFor(readingType)
          const title = `${readingType.name}${m.subtitle ? ` — ${m.subtitle}` : ''}${readingType.unit ? ` (${readingType.unit})` : ''}`
          return <ChartCard title={title} model={m} />
        })()
      ) : null}

      <p className="text-xs text-gray-400">
        Each reading shows as a dot; consecutive readings join into a line. Multi-point readings plot every point for the selected hold; single-value readings plot one line per hold. The PDF includes all points/holds automatically.
      </p>
    </div>
  )
}
