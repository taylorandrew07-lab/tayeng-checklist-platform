'use client'

// Per-device view preferences for the Jobs lists: colour-by mode + month/year
// filter, persisted to localStorage. Plus pure helpers for filtering and building
// the colour legend, shared by the admin / surveyor / office job lists.

import { useEffect, useState } from 'react'
import { resolveColor, type JobColor } from './colors'

export type JobColorMode = 'none' | 'client' | 'type'
export type YearSel = number | 'all'
export type MonthSel = number | 'all' // 0–11, or 'all'

const KEY = { mode: 'jobsColorMode', year: 'jobsFilterYear', month: 'jobsFilterMonth' }

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
      if (y) setYearS(y === 'all' ? 'all' : Number(y))
      const mo = localStorage.getItem(KEY.month)
      if (mo) setMonthS(mo === 'all' ? 'all' : Number(mo))
    } catch { /* storage unavailable */ }
    setReady(true)
  }, [])
  /* eslint-enable react-hooks/set-state-in-effect */

  const persist = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }
  const setColorMode = (m: JobColorMode) => { setColorModeS(m); persist(KEY.mode, m) }
  const setYear = (y: YearSel) => { setYearS(y); persist(KEY.year, String(y)) }
  const setMonth = (m: MonthSel) => { setMonthS(m); persist(KEY.month, String(m)) }

  return { colorMode, setColorMode, year, setYear, month, setMonth, ready }
}

/** Distinct calendar years present in the rows (newest first), from a date field. */
export function availableYears<T>(rows: T[], getDate: (r: T) => string | null | undefined): number[] {
  const set = new Set<number>()
  for (const r of rows) {
    const d = getDate(r)
    if (!d) continue
    const y = new Date(d).getFullYear()
    if (!Number.isNaN(y)) set.add(y)
  }
  return [...set].sort((a, b) => b - a)
}

/** True if a date string falls within the selected year (and month, if not 'all'). */
export function inYearMonth(date: string | null | undefined, year: YearSel, month: MonthSel): boolean {
  if (year === 'all' && month === 'all') return true
  if (!date) return false
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return false
  if (year !== 'all' && d.getFullYear() !== year) return false
  if (month !== 'all' && d.getMonth() !== month) return false
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
