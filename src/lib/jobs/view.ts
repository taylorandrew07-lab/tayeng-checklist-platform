'use client'

// Per-device view preferences for the Jobs lists: colour-by mode + month/year
// filter, persisted to localStorage. Plus pure helpers for filtering and building
// the colour legend, shared by the admin / surveyor / office job lists.

import { useEffect, useState } from 'react'
import { dayKey } from '@/lib/utils'
import { resolveColor, type JobColor } from './colors'

export type JobColorMode = 'none' | 'client' | 'type'
export type YearSel = number | 'all'
export type MonthSel = number | 'all' // 0–11, or 'all'

const KEY = { mode: 'jobsColorMode', year: 'jobsFilterYear', month: 'jobsFilterMonth' }

const persist = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export interface JobsView {
  colorMode: JobColorMode; setColorMode: (m: JobColorMode) => void
  year: YearSel; setYear: (y: YearSel) => void
  month: MonthSel; setMonth: (m: MonthSel) => void
  /** False until localStorage has been read (avoids an SSR/first-paint flash). */
  ready: boolean
}

/** Color-by + month/year filter prefs, persisted per-device in localStorage. */
export function useJobsView(): JobsView {
  const [colorMode, setColorModeS] = useState<JobColorMode>('none')
  const [year, setYearS] = useState<YearSel>('all')
  const [month, setMonthS] = useState<MonthSel>('all')
  const [ready, setReady] = useState(false)

  // Hydrate from localStorage on the client only. setState-in-effect is the
  // hydration-safe pattern for per-device prefs (the server has no localStorage),
  // so the React-Compiler advisory is intentionally suppressed here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const m = localStorage.getItem(KEY.mode)
      if (m === 'none' || m === 'client' || m === 'type') setColorModeS(m)
      const y = localStorage.getItem(KEY.year)
      const yr: YearSel = y ? (y === 'all' ? 'all' : Number(y)) : 'all'
      if (y) setYearS(yr)
      // Month only applies within a chosen year; ignore any stored month while the
      // year is "all" (and heal the stored value) so a stale month can't hide rows.
      const mo = localStorage.getItem(KEY.month)
      if (yr === 'all') { if (mo && mo !== 'all') persist(KEY.month, 'all') }
      else if (mo) setMonthS(mo === 'all' ? 'all' : Number(mo))
    } catch { /* storage unavailable */ }
    setReady(true)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const setColorMode = (m: JobColorMode) => { setColorModeS(m); persist(KEY.mode, m) }
  // Switching to "All time" also clears the month, so the (now disabled) month
  // picker can never keep filtering behind an "All time" label.
  const setYear = (y: YearSel) => {
    setYearS(y); persist(KEY.year, String(y))
    if (y === 'all') { setMonthS('all'); persist(KEY.month, 'all') }
  }
  const setMonth = (m: MonthSel) => { setMonthS(m); persist(KEY.month, String(m)) }

  return { colorMode, setColorMode, year, setYear, month, setMonth, ready }
}

/** The local calendar year + month (0–11) of a job or voyage date, or null if it isn't one.
 *
 *  Everything these lists filter on is a Postgres DATE — `jobs.scheduled_date` /
 *  `jobs.end_date` arrive as a bare '2026-09-01', a wall-calendar day with no instant
 *  attached. `new Date('2026-09-01')` parses that as UTC *midnight*, which in Trinidad
 *  (UTC-4) is 31 Aug 20:00 local, so `getMonth()` answers August for a September job.
 *  That is exactly how the month filter used to hide every 1st-of-the-month job in the
 *  previous month (and every 1 Jan job in the previous year) while the Date column beside
 *  it still read 01 Sep — the column goes through dayKey/parseISO, which treats a
 *  date-only string as LOCAL midnight. Same string, two parsers.
 *
 *  So route through dayKey here too and read the parts straight off the string: no Date
 *  object, no timezone, and the filter agrees with the displayed date by construction. A
 *  timestamptz `created_at` fallback still resolves to its local day, matching formatDate.
 *  Migration 107 fixed this same UTC-parse bug server-side for Analytics; this is the
 *  client-side twin. */
function yearMonthOf(date: string | null | undefined): { year: number; month: number } | null {
  const k = dayKey(date)
  // dayKey echoes back anything it can't parse, so insist on the yyyy-MM-dd shape.
  if (!/^\d{4}-\d{2}-\d{2}/.test(k)) return null
  return { year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) - 1 }
}

/** Distinct calendar years present in the rows (newest first), from a date field. */
export function availableYears<T>(rows: T[], getDate: (r: T) => string | null | undefined): number[] {
  const set = new Set<number>()
  for (const r of rows) {
    const ym = yearMonthOf(getDate(r))
    if (ym) set.add(ym.year)
  }
  return [...set].sort((a, b) => b - a)
}

/** True if a date string falls within the selected year (and month, if not 'all').
 *  Month only narrows *within* a chosen year — the toolbar disables the month
 *  picker when the year is "all". So "All time" ignores any (possibly stale)
 *  month value; otherwise a month left over from a previous selection would
 *  silently hide every other month even though the UI reads "All time". */
export function inYearMonth(date: string | null | undefined, year: YearSel, month: MonthSel): boolean {
  if (year === 'all') return true
  const ym = yearMonthOf(date)
  if (!ym) return false
  if (ym.year !== year) return false
  if (month !== 'all' && ym.month !== month) return false
  return true
}

/** The palette key for a row in the current colour mode. */
export function rowColorKey(mode: JobColorMode, clientColor: string | null, templateColor: string | null): string | null {
  if (mode === 'client') return clientColor
  if (mode === 'type') return templateColor
  return null
}

/** Resolve a row's colour for the current mode (null = render neutral). */
export function rowColor(mode: JobColorMode, clientColor: string | null, templateColor: string | null): JobColor | null {
  return resolveColor(rowColorKey(mode, clientColor, templateColor))
}

export interface LegendItem { label: string; color: JobColor }

/** Build a legend (distinct label→colour) for the current mode from visible rows. */
export function buildLegend(
  mode: JobColorMode,
  rows: { clientName: string | null; clientColor: string | null; typeName: string | null; typeColor: string | null }[],
): LegendItem[] {
  if (mode === 'none') return []
  const seen = new Map<string, LegendItem>()
  for (const r of rows) {
    const label = mode === 'client' ? r.clientName : r.typeName
    const key = mode === 'client' ? r.clientColor : r.typeColor
    const color = resolveColor(key)
    if (!label || !color) continue
    if (!seen.has(label)) seen.set(label, { label, color })
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label))
}
