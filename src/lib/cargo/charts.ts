// Chart model + layout for cargo reading trends. Pure and offline: it turns the
// nested readings map into per-hold time series, then into concrete on-canvas
// coordinates. The same layout feeds both the on-screen preview (DOM SVG) and the
// PDF (react-pdf SVG primitives), so they always match.

import { type Voyage, type ReadingType, type ReadingPoint, type Period, PERIODS, readingTypeAppliesToHold, getReadingValue } from './types'
import { monitoringDates, holdNumbers } from './periods'
import { parseISO, format, isValid } from 'date-fns'

// Distinct, print-safe line colours; cycled if there are >10 holds.
export const HOLD_COLORS = [
  '#1d4ed8', '#dc2626', '#059669', '#d97706', '#7c3aed',
  '#0891b2', '#db2777', '#65a30d', '#475569', '#ea580c',
]
export function holdColor(hold: number): string {
  return HOLD_COLORS[(hold - 1) % HOLD_COLORS.length]
}

export interface ChartFilter {
  /** Specific holds, or 'all' (default = every hold the reading type applies to). */
  holds?: number[] | 'all'
  /** Specific monitoring periods (default = all three). */
  periods?: Period[]
  /** [startISO, endISO] inclusive (default = whole voyage). */
  dateRange?: [string, string]
}

export interface ChartTimepoint { dateISO: string; period: Period }
export interface ChartSeries { hold: number; color: string; values: (number | null)[] }
export interface ChartModel {
  readingType: ReadingType
  point: ReadingPoint
  timepoints: ChartTimepoint[]
  series: ChartSeries[]
  yMin: number
  yMax: number
  hasData: boolean
}

/**
 * Build one (reading type, point) trend model — a line per hold over the timeline.
 * For single-value types pass the type's only point.
 */
export function buildChartModel(voyage: Voyage, readingType: ReadingType, point: ReadingPoint, filter: ChartFilter = {}): ChartModel {
  const [s, e] = filter.dateRange ?? [voyage.startDate, voyage.endDate]
  const dates = monitoringDates(s, e)
  const periods = filter.periods?.length ? filter.periods : PERIODS

  const timepoints: ChartTimepoint[] = []
  for (const d of dates) for (const p of periods) timepoints.push({ dateISO: d, period: p })

  const applicable = holdNumbers(voyage.holdCount).filter(h => readingTypeAppliesToHold(readingType, h))
  const holds = filter.holds && filter.holds !== 'all'
    ? applicable.filter(h => (filter.holds as number[]).includes(h))
    : applicable

  let yMin = Infinity, yMax = -Infinity, hasData = false
  const series: ChartSeries[] = holds.map(hold => {
    const values = timepoints.map(tp => {
      const raw = getReadingValue(voyage, tp.dateISO, tp.period, hold, readingType.id, point.id)
      const n = raw === '' ? NaN : parseFloat(raw)
      if (Number.isFinite(n)) {
        hasData = true
        if (n < yMin) yMin = n
        if (n > yMax) yMax = n
        return n
      }
      return null
    })
    return { hold, color: holdColor(hold), values }
  })

  if (!hasData) { yMin = 0; yMax = 1 }
  else if (yMin === yMax) { yMin -= 1; yMax += 1 } // pad a flat line so it isn't on the axis

  return { readingType, point, timepoints, series, yMin, yMax, hasData }
}

export interface ChartLayout {
  width: number
  height: number
  plot: { left: number; top: number; w: number; h: number }
  baselineY: number
  yTicks: { value: number; y: number }[]
  xTicks: { label: string; x: number }[]
  series: { hold: number; color: string; segments: { x: number; y: number }[][] }[]
}

function shortLabel(tp: ChartTimepoint): string {
  const d = parseISO(tp.dateISO)
  const day = isValid(d) ? format(d, 'dd MMM') : tp.dateISO
  return `${day} ${tp.period.slice(0, 2)}h`
}

/** Compact y-axis number: integers for large magnitudes, one decimal otherwise. */
export function formatTick(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)
}

/** Project a model onto a width×height canvas. Null values break the line (gaps). */
export function layoutChart(model: ChartModel, width: number, height: number): ChartLayout {
  const left = 40, right = 12, top = 12, bottom = 30
  const w = Math.max(1, width - left - right)
  const h = Math.max(1, height - top - bottom)
  const n = model.timepoints.length
  const span = model.yMax - model.yMin || 1

  const xFor = (i: number) => left + (n <= 1 ? w / 2 : (i / (n - 1)) * w)
  const yFor = (v: number) => top + h - ((v - model.yMin) / span) * h

  const yTicks = Array.from({ length: 5 }, (_, k) => {
    const value = model.yMin + (k / 4) * span
    return { value, y: yFor(value) }
  })

  const maxLabels = 6
  const step = Math.max(1, Math.ceil(n / maxLabels))
  const xTicks: { label: string; x: number }[] = []
  for (let i = 0; i < n; i += step) xTicks.push({ label: shortLabel(model.timepoints[i]), x: xFor(i) })

  const series = model.series.map(sr => {
    const segments: { x: number; y: number }[][] = []
    let cur: { x: number; y: number }[] = []
    sr.values.forEach((v, i) => {
      if (v == null) { if (cur.length) { segments.push(cur); cur = [] } }
      else cur.push({ x: xFor(i), y: yFor(v) })
    })
    if (cur.length) segments.push(cur)
    return { hold: sr.hold, color: sr.color, segments }
  })

  return { width, height, plot: { left, top, w, h }, baselineY: top + h, yTicks, xTicks, series }
}
