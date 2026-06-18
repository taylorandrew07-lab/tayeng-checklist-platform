'use client'

// Shared toolbar for the Jobs lists: colour-by segmented control + month/year
// filter + a live count + a colour legend for the active mode. Presentational —
// state lives in useJobsView (src/lib/jobs/view.ts).

import { MONTH_LABELS, type JobColorMode, type JobsView, type LegendItem } from '@/lib/jobs/view'

const MODES: { key: JobColorMode; label: string }[] = [
  { key: 'none', label: 'None' },
  { key: 'client', label: 'Client' },
  { key: 'type', label: 'Job Type' },
]

export default function JobsViewToolbar({ view, years, count, legend }: {
  view: JobsView
  years: number[]
  count: number
  legend: LegendItem[]
}) {
  const { colorMode, setColorMode, year, setYear, month, setMonth } = view
  const periodLabel = year === 'all'
    ? 'All time'
    : month === 'all' ? `All of ${year}` : `${MONTH_LABELS[month]} ${year}`

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* Colour-by */}
      <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 p-0.5 bg-white">
        <span className="text-xs text-gray-400 px-1.5">Colour by</span>
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => setColorMode(m.key)}
            className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${colorMode === m.key ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Month / Year */}
      <div className="inline-flex items-center gap-2">
        <select
          value={month === 'all' ? 'all' : String(month)}
          onChange={e => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          disabled={year === 'all'}
          className="input-base py-1.5 text-sm w-auto disabled:opacity-50"
          title={year === 'all' ? 'Pick a year to filter by month' : 'Month'}
        >
          <option value="all">All months</option>
          {MONTH_LABELS.map((m, i) => <option key={m} value={i}>{m}</option>)}
        </select>
        <select
          value={year === 'all' ? 'all' : String(year)}
          onChange={e => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="input-base py-1.5 text-sm w-auto"
          title="Year"
        >
          <option value="all">All time</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <span className="text-xs text-gray-500 tnum">{periodLabel} · {count} job{count === 1 ? '' : 's'}</span>

      {/* Legend */}
      {legend.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {legend.map(l => (
            <span key={l.label} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded" style={{ backgroundColor: l.color.bg, color: l.color.fg }}>
              {l.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
