// Chart model + layout for cargo reading trends. Pure and offline. Turns the
// nested readings map into time series, then into on-canvas coordinates. The same
// layout feeds both the on-screen preview (DOM SVG) and the PDF (react-pdf SVG).
//
// Two ways to series-ize the same reading type:
//  - buildHoldSeries: one line per HOLD for a single point (e.g. compare O₂ across
//    holds). Natural for single-value gas readings.
//  - buildPointSeries: one line per POINT for a single hold (e.g. all 21
//    thermocouples of Hold 1 on one chart). Natural for multi-point types.

import { type Voyage, type ReadingType, type ReadingPoint, type Period, PERIODS, readingTypeAppliesToHold, getReadingValue } from './types'
import { monitoringDates, holdNumbers } from './periods'
import { parseISO, format, isValid } from 'date-fns'

// Distinct, print-safe line colours; cycled if there are more series than colours.
export const SERIES_COLORS = [
  '#1d4ed8', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d',
  '#475569', '#ea580c', '#0d9488', '#9333ea', '#b91c1c', '#2563eb', '#ca8a04', '#16a34a',
]
export function seriesColor(i: number): string {
  return SERIES_COLORS[i % SERIES_COLORS.length]
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
export interface ChartSeries { key: string; label: string; color: string; values: (number | null)[] }
export interface ChartModel {
  readingType: ReadingType
  /** e.g. "Hold 1" for a points chart; undefined for a holds chart. */
  subtitle?: string
  timepoints: ChartTimepoint[]
  series: ChartSeries[]
  yMin: number
  yMax: number
  hasData: boolean
}

function timeline(voyage: Voyage, filter: ChartFilter): ChartTimepoint[] {
  const [s, e] = filter.dateRange ?? [voyage.startDate, voyage.endDate]
  const dates = monitoringDates(s, e)
  const periods = filter.periods?.length ? filter.periods : PERIODS
  const out: ChartTimepoint[] = []
  for (const d of dates) for (const p of periods) out.push({ dateISO: d, period: p })
  return out
}

function finish(readingType: ReadingType, subtitle: string | undefined, timepoints: ChartTimepoint[], series: ChartSeries[]): ChartModel {
  let yMin = Infinity, yMax = -Infinity, hasData = false
  for (const s of series) for (const v of s.values) {
    if (v != null) { hasData = true; if (v < yMin) yMin = v; if (v > yMax) yMax = v }
  }
  if (!hasData) { yMin = 0; yMax = 1 } else if (yMin === yMax) { yMin -= 1; yMax += 1 }
  return { readingType, subtitle, timepoints, series, yMin, yMax, hasData }
}

/** One line per hold for a single point (compare a reading across holds). */
export function buildHoldSeries(voyage: Voyage, readingType: ReadingType, point: ReadingPoint, filter: ChartFilter = {}): ChartModel {
  const timepoints = timeline(voyage, filter)
  const applicable = holdNumbers(voyage.holdCount).filter(h => readingTypeAppliesToHold(readingType, h))
  const holds = filter.holds && filter.holds !== 'all' ? applicable.filter(h => (filter.holds as number[]).includes(h)) : applicable

  const series: ChartSeries[] = holds.map((hold, i) => ({
    key: `hold-${hold}`,
    label: `Hold ${hold}`,
    color: seriesColor(i),
    values: timepoints.map(tp => {
      const n = parseFloat(getReadingValue(voyage, tp.dateISO, tp.period, hold, readingType.id, point.id))
      return Number.isFinite(n) ? n : null
    }),
  }))
  return finish(readingType, undefined, timepoints, series)
}

/** One line per point for a single hold (e.g. all thermocouples of Hold 1). */
export function buildPointSeries(voyage: Voyage, readingType: ReadingType, hold: number, pointSel: 'all' | string[], filter: ChartFilter = {}): ChartModel {
  const timepoints = timeline(voyage, filter)
  const points = pointSel === 'all' ? readingType.points : readingType.points.filter(p => pointSel.includes(p.id))

  const series: ChartSeries[] = points.map((pt, i) => ({
    key: pt.id,
    label: pt.group ? `${pt.group} · ${pt.name}` : (pt.name || readingType.name),
    color: seriesColor(i),
    values: timepoints.map(tp => {
      const n = parseFloat(getReadingValue(voyage, tp.dateISO, tp.period, hold, readingType.id, pt.id))
      return Number.isFinite(n) ? n : null
    }),
  }))
  return finish(readingType, `Hold ${hold}`, timepoints, series)
}

export interface ChartLayout {
  width: number
  height: number
  plot: { left: number; top: number; w: number; h: number }
  baselineY: number
  yTicks: { value: number; y: number }[]
  xTicks: { label: string; x: number }[]
  series: { key: string; label: string; color: string; segments: { x: number; y: number }[][] }[]
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
    return { key: sr.key, label: sr.label, color: sr.color, segments }
  })

  return { width, height, plot: { left, top, w, h }, baselineY: top + h, yTicks, xTicks, series }
}
