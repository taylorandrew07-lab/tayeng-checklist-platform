// Hours ⇄ days labour unit (migration 148).
//
// A job is paid and billed either by the HOUR or by the DAY. The unit is per JOB
// (jobs.labour_unit) and applies to every surveyor on it. The quantity itself is
// still stored in job_surveyors.regular_hours/.overtime_hours and the rate in
// .pay_rate/.overtime_rate, so pay = quantity × rate stays exactly correct in both
// units — only the WORDS change. Every unit-aware label lives here so nothing drifts.
//
// The unit-split labour metrics live here too: hours and days must never be added
// into one number, so the RPCs return them as separate columns and the Finance
// Overview renders them side by side.

import { createClient } from '@/lib/supabase/client'

export type LabourUnit = 'hours' | 'days'

/** Anything off the wire can be null/undefined (older rows, narrower selects) —
 *  hours is the default, matching the column default. */
export function asLabourUnit(v: string | null | undefined): LabourUnit {
  return v === 'days' ? 'days' : 'hours'
}

export interface LabourUnitLabels {
  /** Field label for the regular quantity — "Regular hrs" / "Regular days". */
  regular: string
  /** Field label for the overtime quantity — "Overtime hrs" / "Overtime days". */
  overtime: string
  payRate: string
  otRate: string
  /** Compact suffix: the "8h" / "2d" form. */
  suffix: string
  /** Lower-case noun for prose — "hours" / "days". */
  noun: string
  /** Read-only pill wording for anyone who may not change the unit. */
  pill: string
  /** Toggle label. */
  toggle: string
}

const LABELS: Record<LabourUnit, LabourUnitLabels> = {
  hours: {
    regular: 'Regular hrs', overtime: 'Overtime hrs',
    payRate: 'Pay rate /hr', otRate: 'OT rate /hr',
    suffix: 'h', noun: 'hours', pill: 'Billed by the hour', toggle: 'Hours',
  },
  days: {
    regular: 'Regular days', overtime: 'Overtime days',
    payRate: 'Pay rate /day', otRate: 'OT rate /day',
    suffix: 'd', noun: 'days', pill: 'Billed by the day', toggle: 'Days',
  },
}

export const labourLabels = (u?: string | null): LabourUnitLabels => LABELS[asLabourUnit(u)]

// One decimal is right for a screen, where a quantity is read, not checked. A printed
// sheet is different: a shift is stored to TWO decimals (shiftHours, mig 157), so on a
// document whose whole purpose is adding the lines up by hand, one decimal per line makes
// the lines visibly disagree with their own subtotal — 3 × 9.33 h prints as 9.3 + 9.3 +
// 9.3 under a subtotal of 28. `maxDp` is how a caller that must ADD UP asks for the
// stored precision; everything on screen keeps the tidier default.
const fmtQty = (n: number, maxDp = 1) => n.toLocaleString(undefined, { maximumFractionDigits: maxDp })

/** A single job's quantity with its own unit — "8h" / "2d". Safe because the unit
 *  is per job, so one job's numbers are never mixed. */
export const qtyWithUnit = (n: number, u?: string | null, maxDp = 1): string => `${fmtQty(n, maxDp)}${labourLabels(u).suffix}`

/** THE HARD RULE. A total that spans several jobs can span both units, and hours may
 *  never be added to days — so it is written out per unit ("142.5 h · 6 d") and never
 *  collapsed into one unlabelled number. Returns '' when there is nothing to show. */
export function splitQty(hours: number, days: number, maxDp = 1): string {
  const parts: string[] = []
  if (hours) parts.push(`${fmtQty(hours, maxDp)} h`)
  if (days) parts.push(`${fmtQty(days, maxDp)} d`)
  return parts.join(' · ')
}

// ── Unit-split labour metrics (migration 148) ────────────────────────────────

export interface SurveyorLabourSplit {
  surveyor_id: string; name: string
  /** Hours-billed jobs only. */
  regular_hours: number; overtime_hours: number
  /** Day-billed jobs only. Never added to the two above. */
  regular_days: number; overtime_days: number
  km: number
  pay: { currency: string; total: number }[]
}

export interface SurveyorJobLabourSplit {
  surveyor_id: string; job_id: string
  job_title: string; vessel_name: string | null; report_number: string | null; job_date: string | null
  /** The job's own unit — the row's quantities are in it. */
  labour_unit: LabourUnit
  regular_hours: number; overtime_hours: number; km: number
  pay: { currency: string; total: number }[]
}

/** Labour per surveyor (quantity per unit, km, pay), optionally windowed to a date
 *  range (YYYY-MM-DD, inclusive) for the monthly pay run. Day-worked attribution:
 *  OT shifts count on their own date, km on the trip date, regular (and a day-billed
 *  job's typed OT) on the job date — see mig 125/148. */
export async function metricsLabourSplit(
  from?: string | null,
  to?: string | null,
  /** The panel renders an empty table on failure — a screen that is momentarily blank is
   *  recoverable by reloading. A DOCUMENT built off this is not: a pay run printed from a
   *  failed call comes out titled PAY RUN with no pay on it and every surveyor apparently
   *  owed nothing. Anything that hands the result to a file passes `throwOnError`. */
  opts?: { throwOnError?: boolean },
): Promise<SurveyorLabourSplit[]> {
  const { data, error } = await createClient().rpc('metrics_labour', { p_from: from ?? null, p_to: to ?? null })
  if (error && opts?.throwOnError) throw new Error(error.message)
  return ((data ?? []) as any[])
    .map(l => ({
      surveyor_id: l.surveyor_id, name: l.name,
      regular_hours: Number(l.regular_hours ?? 0), overtime_hours: Number(l.overtime_hours ?? 0),
      regular_days: Number(l.regular_days ?? 0), overtime_days: Number(l.overtime_days ?? 0),
      km: Number(l.km ?? 0),
      pay: Object.entries((l.pay ?? {}) as Record<string, number>).map(([currency, total]) => ({ currency, total: Number(total) })),
    }))
    .filter(s => s.regular_hours || s.overtime_hours || s.regular_days || s.overtime_days || s.km)
    // Ordered by pay, not by a quantity — a quantity would rank 3 days below 8 hours.
    .sort((a, b) => b.pay.reduce((s, p) => s + p.total, 0) - a.pay.reduce((s, p) => s + p.total, 0) || b.km - a.km)
}

/** The per-job breakdown behind a surveyor's labour row (same window + day-worked
 *  rule, at job grain — mig 126). Each row carries its job's unit, and the rows for
 *  a surveyor sum to that surveyor's totals WITHIN each unit. Returned as a Map keyed
 *  by surveyor_id so the Overview can expand one row at a time. */
export async function metricsLabourByJobSplit(from?: string | null, to?: string | null): Promise<Map<string, SurveyorJobLabourSplit[]>> {
  const { data } = await createClient().rpc('metrics_labour_by_job', { p_from: from ?? null, p_to: to ?? null })
  const byS = new Map<string, SurveyorJobLabourSplit[]>()
  for (const l of (data ?? []) as any[]) {
    const row: SurveyorJobLabourSplit = {
      surveyor_id: l.surveyor_id, job_id: l.job_id,
      job_title: l.job_title ?? '', vessel_name: l.vessel_name ?? null,
      report_number: l.report_number ?? null, job_date: l.job_date ?? null,
      labour_unit: asLabourUnit(l.labour_unit),
      regular_hours: Number(l.regular_hours ?? 0), overtime_hours: Number(l.overtime_hours ?? 0),
      km: Number(l.km ?? 0),
      pay: Object.entries((l.pay ?? {}) as Record<string, number>).map(([currency, total]) => ({ currency, total: Number(total) })),
    }
    const arr = byS.get(row.surveyor_id); if (arr) arr.push(row); else byS.set(row.surveyor_id, [row])
  }
  // Most recent job first within each surveyor's breakdown.
  for (const arr of byS.values()) arr.sort((a, b) => (b.job_date ?? '').localeCompare(a.job_date ?? ''))
  return byS
}
