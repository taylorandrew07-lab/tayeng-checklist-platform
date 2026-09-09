// The monthly Labour & Overtime report — shift by shift, per surveyor.
//
// Finance → Overview shows one ROW per surveyor for a month, expandable to a per-JOB
// breakdown. This module is what gets that off the screen: every individual shift, with
// its date, vessel, times, regular-vs-overtime quantity and km, plus per-surveyor and
// company subtotals, shaped once here and consumed unchanged by BOTH the PDF renderer
// and the CSV so the two can never disagree with each other.
//
// THE ACCEPTANCE TEST IS RECONCILIATION. For any window, each surveyor's totals here
// must equal metrics_labour(p_from, p_to) for that surveyor — regular hours, overtime
// hours, regular days, overtime days and km. A pay sheet that quietly disagrees with the
// screen it was printed from is worse than no pay sheet, so the comparison is not a
// test that runs somewhere else: `LabourReport.unreconciled` is computed on EVERY run
// and, when non-empty, is printed on the document itself.
//
// Two things make that identity hold, both of them owned by the RPC (migration 210) and
// preserved verbatim here:
//   * A typed quantity with NO shift log behind it still produces a line (has_shift_log
//     false). ~30% of all regular hours in this database are typed with no log; drop
//     them and the report silently under-reports against the panel above it.
//   * A line carries TWO dates. `attribution_date` is the day metrics_labour counts it
//     on; `line_date` is the day the office reads. They differ for a regular shift
//     logged in a different month from its job's scheduled date — metrics_labour windows
//     regular quantity on the JOB date (mig 165), and this report must not re-window it.
//
// HOURS AND DAYS ARE NEVER ADDED. A job is paid by the hour OR by the day
// (jobs.labour_unit, mig 148). Every quantity string in here comes from
// lib/jobs/labourUnit.ts — qtyWithUnit() for one job's line, splitQty() for any total
// that can span both units ("142.5 h · 6 d"). Nothing in this file writes a unit word.

import { createClient } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
import { formatDate, vesselWithVoyage, type VesselPrefix } from '@/lib/utils'
import { money } from '@/lib/jobs/tracker'
import {
  asLabourUnit, qtyWithUnit, splitQty, labourLabels, metricsLabourSplit,
  type LabourUnit, type SurveyorLabourSplit,
} from '@/lib/jobs/labourUnit'
import type {
  LabourReportPdfProps, LabourReportPdfRow, LabourReportPdfSurveyor,
} from '@/lib/pdf/LabourReportPDF'

export type LabourLineKind = 'regular' | 'overtime' | 'km'

/** One row exactly as public.labour_shift_lines returns it (migration 210). */
export interface LabourShiftLine {
  line_id: string
  surveyor_id: string
  surveyor_name: string
  job_surveyor_id: string
  job_id: string
  job_number: string | null
  job_title: string | null
  report_number: string | null
  vessel_name: string | null
  vessel_type: string | null
  voyage_number: string | null
  client_name: string | null
  labour_unit: LabourUnit
  kind: LabourLineKind
  /** YYYY-MM-DD. The day the office reads. Always a sliced string — never a Date. */
  line_date: string
  /** YYYY-MM-DD. The day metrics_labour counts this quantity on. */
  attribution_date: string
  start_time: string | null
  end_date: string | null
  end_time: string | null
  location: string | null
  note: string | null
  has_shift_log: boolean
  /** A day-billed job's logged shift: a record of the hours worked, never the payable
   *  quantity (mig 157). It prints — with its date and times — carrying qty 0. */
  evidence_only: boolean
  /** Hours OR days per labour_unit; 0 on a km line. */
  qty: number
  /** 0 on a regular/overtime line. */
  km: number
}

/** One PRINTED line.
 *
 *  Everything the renderer may read is a preformatted string — the PDF must never see a
 *  raw quantity and must never decide "h" vs "d" (the same contract as StatementRow in
 *  SurveyorStatementPDF). `raw` exists ONLY for the CSV, which writes bare summable
 *  numbers with the unit in its own column; the PDF must not touch it. */
export interface LabourReportRow {
  lineId: string
  /** YYYY-MM-DD, for sorting only. */
  dateKey: string
  /** 'dd MMM yyyy'. */
  date: string
  kind: LabourLineKind
  vessel: string
  /** Report number, else job number. */
  job: string
  client: string
  /** '08:00 – 17:00' · '19:00 – 03:30' · 'travel' · '—'. */
  span: string
  /** 'ends 21 Aug' — set ONLY when the shift rolls past midnight, so the end DATE is
   *  printed as well as the end time. '' otherwise. */
  spanEnd: string
  overnight: boolean
  reg: string
  ot: string
  km: string
  /** labourLabels(unit).noun — 'hours' | 'days'. */
  unitNoun: string
  /** '' | 'no shift log' | 'typed day count' | 'shift record, not payable'. */
  flag: string
  /** location + note, joined ' · '. */
  note: string
  raw: {
    unit: LabourUnit
    reg: number
    ot: number
    km: number
    hasShiftLog: boolean
    evidenceOnly: boolean
    lineDate: string
    attributionDate: string
    startTime: string | null
    endTime: string | null
    endDate: string | null
    jobNumber: string | null
    reportNumber: string | null
  }
}

/** The five numbers metrics_labour returns, in the same shape, so a caller can compare
 *  field for field. Hours and days stay in separate fields — always. */
export interface LabourUnitTotals {
  regHours: number
  regDays: number
  otHours: number
  otDays: number
  km: number
}

export interface LabourReportSurveyor {
  surveyorId: string
  name: string
  rows: LabourReportRow[]
  totals: LabourUnitTotals
  /** splitQty(regHours, regDays) — '142.5 h · 6 d'. Never one collapsed number. */
  totalReg: string
  totalOt: string
  totalKm: string
  /** Shift lines only; a km trip is not a shift. */
  shiftCount: number
  /** Empty on the quantities-only variant. */
  pay: { currency: string; total: number }[]
  /** Empty on the quantities-only variant. Currencies joined, never summed. */
  payLabel: string
}

export interface LabourReconcileIssue {
  surveyorId: string
  name: string
  field: 'regular hours' | 'overtime hours' | 'regular days' | 'overtime days' | 'km'
  report: number
  panel: number
}

export interface LabourReport {
  periodLabel: string
  generatedLabel: string
  withPay: boolean
  surveyors: LabourReportSurveyor[]
  company: {
    totals: LabourUnitTotals
    totalReg: string
    totalOt: string
    totalKm: string
    surveyorCount: number
    pay: { currency: string; total: number }[]
    payLabel: string
  }
  /** Empty means this report equals metrics_labour for every surveyor in the window.
   *  Non-empty is printed on the document itself — the one failure mode that must
   *  never be quiet. */
  unreconciled: LabourReconcileIssue[]
}

// ── Fetch ────────────────────────────────────────────────────────────────────

/** The shift-grain source (migration 210). SECURITY INVOKER and carrying NO pay column
 *  of any kind: admin sees everyone, a surveyor sees only their own rows, exactly as
 *  metrics_labour already does. Throws on failure — the button must fail loudly rather
 *  than hand the office an empty PDF. */
export async function fetchLabourShiftLines(from: string | null, to: string | null): Promise<LabourShiftLine[]> {
  const { data, error } = await createClient().rpc('labour_shift_lines', { p_from: from ?? null, p_to: to ?? null })
  if (error) throw new Error(error.message)
  // PostgREST returns numeric as a string; every quantity goes through Number().
  return ((data ?? []) as any[]).map(l => ({
    line_id: String(l.line_id),
    surveyor_id: l.surveyor_id,
    surveyor_name: l.surveyor_name ?? 'Unknown',
    job_surveyor_id: l.job_surveyor_id,
    job_id: l.job_id,
    job_number: l.job_number ?? null,
    job_title: l.job_title ?? null,
    report_number: l.report_number ?? null,
    vessel_name: l.vessel_name ?? null,
    vessel_type: l.vessel_type ?? null,
    voyage_number: l.voyage_number ?? null,
    client_name: l.client_name ?? null,
    labour_unit: asLabourUnit(l.labour_unit),
    kind: (l.kind === 'overtime' || l.kind === 'km' ? l.kind : 'regular') as LabourLineKind,
    line_date: String(l.line_date ?? '').slice(0, 10),
    attribution_date: String(l.attribution_date ?? '').slice(0, 10),
    start_time: l.start_time ?? null,
    end_date: l.end_date ? String(l.end_date).slice(0, 10) : null,
    end_time: l.end_time ?? null,
    location: l.location ?? null,
    note: l.note ?? null,
    has_shift_log: l.has_shift_log === true,
    evidence_only: l.evidence_only === true,
    qty: Number(l.qty ?? 0),
    km: Number(l.km ?? 0),
  }))
}

// ── Shaping ──────────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100

/** 'HH:MM:SS' off the wire → 'HH:MM'. Never a Date. */
const hhmm = (t: string | null): string | null => (t ? t.slice(0, 5) : null)

/** A shift span: '08:00 – 17:00'. This module now owns this format — the twin at
 *  JobOpsPanel's fmtSpan is not exported and that component is not ours to change.
 *  Built from the stored strings only: a date-only value parsed with `new Date()` is
 *  UTC midnight, which reads as the previous day in Trinidad.
 *
 *  The separator is an EN DASH, not an arrow. Helvetica is a PDF standard-14 font with
 *  WinAnsiEncoding, and U+2192 is not in it: @react-pdf does not throw and does not drop
 *  it, it writes the low byte, so an arrow prints on the delivered sheet as an
 *  apostrophe. Every character that reaches the PDF must exist in WinAnsi — the en dash,
 *  the em dash and the middot all do. */
function shiftSpan(line: LabourShiftLine): string {
  if (line.kind === 'km') return 'travel'
  const start = hhmm(line.start_time)
  const end = hhmm(line.end_time)
  if (!start && !end) return '—'
  return `${start ?? '--:--'} – ${end ?? '--:--'}`
}

/** A shift that rolls past midnight prints its END DATE as well as its end time, on its
 *  own short line under the span. `end_date` is compared as a string, never parsed. */
function shiftEndLabel(line: LabourShiftLine): string {
  if (line.kind === 'km') return ''
  if (!line.end_date || line.end_date === line.line_date) return ''
  try {
    return `ends ${format(parseISO(line.end_date), 'dd MMM')}`
  } catch {
    return `ends ${line.end_date}`
  }
}

const KIND_ORDER: Record<LabourLineKind, number> = { regular: 0, overtime: 1, km: 2 }

function toRow(line: LabourShiftLine): LabourReportRow {
  const unit = line.labour_unit
  const isKm = line.kind === 'km'
  const vessel = vesselWithVoyage(line.vessel_name, line.vessel_type as VesselPrefix | null, line.voyage_number)
  const reg = line.kind === 'regular' ? line.qty : 0
  const ot = line.kind === 'overtime' ? line.qty : 0
  const km = isKm ? line.km : 0
  const noteParts = [line.location, line.note].map(v => (v ?? '').trim()).filter(Boolean)
  // Three different things, and the sheet must not confuse them:
  //   * a logged shift on an hours job — the quantity IS the shift, nothing to say;
  //   * a logged shift on a day-billed job — real, dated, timed, but worth 0 here,
  //     because the payable quantity is the typed day count (mig 157);
  //   * a typed quantity with no shift behind it at all.
  const flag = line.evidence_only ? 'shift record, not payable'
    : line.has_shift_log ? ''
    : (unit === 'days' ? 'typed day count' : 'no shift log')
  return {
    lineId: line.line_id,
    dateKey: line.line_date,
    date: formatDate(line.line_date),
    kind: line.kind,
    vessel: vessel || line.job_title || '—',
    job: line.report_number ?? line.job_number ?? '—',
    client: line.client_name ?? '—',
    span: shiftSpan(line),
    spanEnd: shiftEndLabel(line),
    overnight: !!line.end_date && !isKm && line.end_date !== line.line_date,
    // TWO decimals, not the screen's one: a shift is stored to 2dp, and on a sheet the
    // office adds up by hand the lines must sum to the subtotal printed under them.
    reg: reg ? qtyWithUnit(reg, unit, 2) : '—',
    ot: ot ? qtyWithUnit(ot, unit, 2) : '—',
    km: km ? `${km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : '—',
    unitNoun: labourLabels(unit).noun,
    flag,
    note: noteParts.join(' · '),
    raw: {
      unit, reg, ot, km,
      hasShiftLog: line.has_shift_log,
      evidenceOnly: line.evidence_only,
      lineDate: line.line_date,
      attributionDate: line.attribution_date,
      startTime: hhmm(line.start_time),
      endTime: hhmm(line.end_time),
      endDate: line.end_date,
      jobNumber: line.job_number,
      reportNumber: line.report_number,
    },
  }
}

const emptyTotals = (): LabourUnitTotals => ({ regHours: 0, regDays: 0, otHours: 0, otDays: 0, km: 0 })

function addLine(t: LabourUnitTotals, line: LabourShiftLine) {
  // THE HARD RULE: an hours quantity is never added to a days one. The unit decides
  // which field a quantity lands in, and the two are only ever printed side by side.
  if (line.kind === 'regular') {
    if (line.labour_unit === 'days') t.regDays += line.qty; else t.regHours += line.qty
  } else if (line.kind === 'overtime') {
    if (line.labour_unit === 'days') t.otDays += line.qty; else t.otHours += line.qty
  } else {
    t.km += line.km
  }
}

function roundTotals(t: LabourUnitTotals): LabourUnitTotals {
  return {
    regHours: round2(t.regHours), regDays: round2(t.regDays),
    otHours: round2(t.otHours), otDays: round2(t.otDays), km: round2(t.km),
  }
}

const payLabelFor = (pay: { currency: string; total: number }[]) =>
  pay.map(p => money(p.total, p.currency)).join(' · ')

/** Period wording for the report header. `parseISO` is local-safe — `new Date('2026-09-01')`
 *  is UTC midnight and reads as 31 August in Trinidad. */
export function periodLabelFor(mode: 'month' | 'year' | 'all', month: string, year: string): string {
  if (mode === 'month') {
    try {
      return format(parseISO(`${month}-01`), 'MMMM yyyy')
    } catch {
      return month
    }
  }
  if (mode === 'year') return year
  return 'All time'
}

const RECONCILE_FIELDS: { key: keyof LabourUnitTotals; panel: keyof SurveyorLabourSplit; label: LabourReconcileIssue['field'] }[] = [
  { key: 'regHours', panel: 'regular_hours', label: 'regular hours' },
  { key: 'otHours', panel: 'overtime_hours', label: 'overtime hours' },
  { key: 'regDays', panel: 'regular_days', label: 'regular days' },
  { key: 'otDays', panel: 'overtime_days', label: 'overtime days' },
  { key: 'km', panel: 'km', label: 'km' },
]

/** PURE. The whole report, shaped from the shift lines and the panel's own totals.
 *
 *  Quantities and km are summed FROM THE LINES, never copied off the panel — that is
 *  what makes the comparison in `unreconciled` mean anything. Pay is the reverse: it
 *  comes ONLY from the panel (metrics_labour), because the shift-grain RPC carries no
 *  pay column at all, which is the whole security design. */
export function buildLabourReport(
  lines: LabourShiftLine[],
  panel: SurveyorLabourSplit[],
  opts: { periodLabel: string; generatedLabel: string; withPay: boolean },
): LabourReport {
  const { withPay } = opts

  const byId = new Map<string, LabourShiftLine[]>()
  for (const l of lines) {
    const arr = byId.get(l.surveyor_id)
    if (arr) arr.push(l); else byId.set(l.surveyor_id, [l])
  }
  const panelById = new Map(panel.map(p => [p.surveyor_id, p]))

  // Surveyor order MIRRORS the panel (already sorted pay desc, then km desc), so the
  // sheet and the screen read in the same order. Anyone with lines but no panel row
  // sorts last, by name.
  const order: string[] = panel.map(p => p.surveyor_id)
  const extras = [...byId.keys()]
    .filter(id => !panelById.has(id))
    .sort((a, b) => (byId.get(a)?.[0]?.surveyor_name ?? '').localeCompare(byId.get(b)?.[0]?.surveyor_name ?? ''))
  order.push(...extras)

  const surveyors: LabourReportSurveyor[] = []
  const unreconciled: LabourReconcileIssue[] = []
  const companyTotals = emptyTotals()
  const companyPay = new Map<string, number>()

  for (const id of order) {
    const mine = byId.get(id) ?? []
    const p = panelById.get(id)
    const name = p?.name ?? mine[0]?.surveyor_name ?? 'Unknown'

    const raw = emptyTotals()
    for (const l of mine) addLine(raw, l)
    const totals = roundTotals(raw)

    const rows = mine.map(toRow).sort((a, b) =>
      a.dateKey.localeCompare(b.dateKey)
      || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      // A line with no time (a typed quantity, or a km trip) sorts AFTER the logged
      // shifts of the same day. Tested as a flag, not with a sentinel string: a
      // locale-aware compare does not order punctuation by code point.
      || (a.raw.startTime ? 0 : 1) - (b.raw.startTime ? 0 : 1)
      || (a.raw.startTime ?? '').localeCompare(b.raw.startTime ?? '')
      || a.lineId.localeCompare(b.lineId))

    // Pay never reaches the circulate-safe file, not even as an empty string a later
    // renderer edit could start printing.
    const pay = withPay ? (p?.pay ?? []) : []

    surveyors.push({
      surveyorId: id,
      name,
      rows,
      totals,
      totalReg: splitQty(totals.regHours, totals.regDays, 2) || '—',
      totalOt: splitQty(totals.otHours, totals.otDays, 2) || '—',
      totalKm: totals.km ? `${totals.km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : '—',
      // Only lines with a shift actually recorded behind them. A typed quantity is the
      // report saying no shift exists; counting it here would make the header contradict
      // the rows under it, on the one document whose job is to show what was worked.
      shiftCount: rows.filter(r => r.kind !== 'km' && r.raw.hasShiftLog).length,
      pay,
      payLabel: withPay ? payLabelFor(pay) : '',
    })

    companyTotals.regHours += totals.regHours
    companyTotals.regDays += totals.regDays
    companyTotals.otHours += totals.otHours
    companyTotals.otDays += totals.otDays
    companyTotals.km += totals.km
    for (const c of pay) companyPay.set(c.currency, (companyPay.get(c.currency) ?? 0) + c.total)

    // THE ACCEPTANCE TEST, run on every single build. A missing panel row counts as
    // zeros, so a surveyor who appears on only one side is reported, not skipped.
    for (const f of RECONCILE_FIELDS) {
      const report = totals[f.key]
      const panelVal = round2(Number((p?.[f.panel] as number | undefined) ?? 0))
      if (Math.abs(report - panelVal) > 0.005) {
        unreconciled.push({ surveyorId: id, name, field: f.label, report, panel: panelVal })
      }
    }
  }

  const cTot = roundTotals(companyTotals)
  const cPay = [...companyPay.entries()].map(([currency, total]) => ({ currency, total: round2(total) }))

  return {
    periodLabel: opts.periodLabel,
    generatedLabel: opts.generatedLabel,
    withPay,
    surveyors,
    company: {
      totals: cTot,
      totalReg: splitQty(cTot.regHours, cTot.regDays, 2) || '—',
      totalOt: splitQty(cTot.otHours, cTot.otDays, 2) || '—',
      totalKm: cTot.km ? `${cTot.km.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : '—',
      surveyorCount: surveyors.length,
      pay: cPay,
      payLabel: withPay ? payLabelFor(cPay) : '',
    },
    unreconciled,
  }
}

/** Fetch + shape in one call. The pay variant takes 100% of its money from
 *  metricsLabourSplit() — the SAME already-gated RPC the Finance Overview panel calls —
 *  so this feature adds exactly zero new pay exposure. */
export async function getLabourReport(
  from: string | null,
  to: string | null,
  opts: { periodLabel: string; withPay: boolean },
): Promise<LabourReport> {
  const [lines, panel] = await Promise.all([
    fetchLabourShiftLines(from, to),
    // throwOnError, unlike the panel on screen: a failed metrics_labour here would
    // otherwise produce a document headed PAY RUN with no pay on it and a warnings block
    // claiming the Finance panel shows zero for everyone. No pay sheet at all is the only
    // acceptable outcome of a failed pay call.
    metricsLabourSplit(from, to, { throwOnError: true }),
  ])
  // Local clock, not toISOString() — after 8pm in Trinidad the UTC date is tomorrow.
  return buildLabourReport(lines, panel, { ...opts, generatedLabel: format(new Date(), 'dd MMM yyyy') })
}

// ── PDF props ────────────────────────────────────────────────────────────────

/** Display strings only. Drops `raw` entirely, so the renderer cannot reach a quantity
 *  and cannot decide an hours-vs-days suffix; and when the variant is quantities-only,
 *  every pay-shaped field is '' before it ever leaves this module. */
export function labourReportPdfProps(report: LabourReport): LabourReportPdfProps {
  const surveyors: LabourReportPdfSurveyor[] = report.surveyors.map(s => ({
    name: s.name,
    rows: s.rows.map((r): LabourReportPdfRow => ({
      date: r.date,
      vessel: r.vessel,
      job: r.job,
      client: r.client,
      span: r.span,
      spanEnd: r.spanEnd,
      reg: r.reg,
      ot: r.ot,
      km: r.km,
      flag: r.flag,
    })),
    totalReg: s.totalReg,
    totalOt: s.totalOt,
    totalKm: s.totalKm,
    shifts: String(s.shiftCount),
    payLabel: report.withPay ? s.payLabel : '',
  }))
  return {
    periodLabel: report.periodLabel,
    generatedLabel: report.generatedLabel,
    withPay: report.withPay,
    surveyors,
    totalReg: report.company.totalReg,
    totalOt: report.company.totalOt,
    totalKm: report.company.totalKm,
    surveyorCount: String(report.company.surveyorCount),
    companyPayLabel: report.withPay ? report.company.payLabel : '',
    // No arrow: this string is printed by Helvetica, whose WinAnsi encoding has none.
    warnings: report.unreconciled.map(u =>
      `${u.name} — ${u.field}: this report ${u.report}, the Finance Overview panel ${u.panel}`),
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const esc = (v: any) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/** Column positions, so a subtotal row is written by name and can never drift out of
 *  alignment with the detail rows above it. */
// A quantity column holds ONE unit and only ever that unit. The Unit column stays as
// prose, but it is not what protects the sheet: an office user selects a column and reads
// the status bar, and if hours and days shared one column that sum would be 8 hours plus
// 6 days = 14 of nothing (mig 148). Four columns make the wrong sum impossible to take.
const CSV_COLS = [
  'Surveyor', 'Date', 'Kind', 'Vessel', 'Report #', 'Job #', 'Client',
  'Shift start', 'Shift end', 'Shift end date', 'Overnight', 'Unit',
  'Regular hours', 'Regular days', 'Overtime hours', 'Overtime days',
  'Km', 'Shift log', 'Note',
] as const
type CsvCol = typeof CSV_COLS[number] | 'Currency' | 'Pay'

/** The same rows the PDF prints, for checking in Excel.
 *
 *  Quantities are written BARE, in a column per unit, and there are TWO subtotal rows —
 *  one per unit — so a spreadsheet cannot add an hours quantity to a days one. Returns
 *  the text only; the caller prepends the BOM. */
export function labourReportCsv(report: LabourReport): string {
  const cols: CsvCol[] = report.withPay ? [...CSV_COLS, 'Currency', 'Pay'] : [...CSV_COLS]
  const row = (cells: Partial<Record<CsvCol, string | number>>) =>
    cols.map(c => esc(cells[c] ?? '')).join(',')

  const lines: string[] = [cols.map(esc).join(',')]

  const unitRows = (who: string, kindLabel: (u: string) => string, t: LabourUnitTotals, withKm: boolean) => {
    lines.push(row({
      Surveyor: who, Kind: kindLabel('hours'), Unit: labourLabels('hours').noun,
      'Regular hours': t.regHours || '', 'Overtime hours': t.otHours || '',
      // Km rides on the hours row only, so it is never counted twice.
      Km: withKm ? (t.km || '') : '',
    }))
    if (t.regDays || t.otDays) {
      lines.push(row({
        Surveyor: who, Kind: kindLabel('days'), Unit: labourLabels('days').noun,
        'Regular days': t.regDays || '', 'Overtime days': t.otDays || '',
      }))
    }
  }

  for (const s of report.surveyors) {
    for (const r of s.rows) {
      lines.push(row({
        // Repeated on every row so the sheet sorts and filters in Excel.
        Surveyor: s.name,
        // The raw YYYY-MM-DD, so Excel sorts it.
        Date: r.raw.lineDate,
        Kind: r.kind,
        Vessel: r.vessel,
        'Report #': r.raw.reportNumber ?? '',
        'Job #': r.raw.jobNumber ?? '',
        Client: r.client,
        'Shift start': r.raw.startTime ?? '',
        'Shift end': r.raw.endTime ?? '',
        // A shift crossing midnight carries its end DATE as well as its end time.
        'Shift end date': r.overnight ? (r.raw.endDate ?? '') : '',
        Overnight: r.overnight ? 'yes' : '',
        Unit: r.unitNoun,
        // Bare numbers — Excel must be able to sum them — each in its own unit's column.
        'Regular hours': r.raw.unit === 'hours' ? (r.raw.reg || '') : '',
        'Regular days': r.raw.unit === 'days' ? (r.raw.reg || '') : '',
        'Overtime hours': r.raw.unit === 'hours' ? (r.raw.ot || '') : '',
        'Overtime days': r.raw.unit === 'days' ? (r.raw.ot || '') : '',
        Km: r.raw.km || '',
        // Three states, never two: a shift, a shift that is only a record (day-billed),
        // and a typed quantity with nothing behind it.
        'Shift log': r.raw.evidenceOnly ? 'RECORD ONLY' : r.raw.hasShiftLog ? 'yes' : 'NO SHIFT LOG',
        Note: r.note,
        // Per-line pay does not exist in any gated source and is not invented here.
      }))
    }
    unitRows(s.name, u => `SUBTOTAL (${u})`, s.totals, true)
    if (report.withPay) {
      // One row PER CURRENCY, so every Pay cell is a summable number in one currency.
      for (const p of s.pay) {
        lines.push(row({ Surveyor: s.name, Kind: 'SUBTOTAL (pay)', Currency: p.currency, Pay: p.total }))
      }
    }
  }

  unitRows('ALL SURVEYORS', u => `TOTAL (${u})`, report.company.totals, true)
  if (report.withPay) {
    for (const p of report.company.pay) {
      lines.push(row({ Surveyor: 'ALL SURVEYORS', Kind: 'TOTAL (pay)', Currency: p.currency, Pay: p.total }))
    }
  }

  // The office must never receive a spreadsheet that silently disagrees with the
  // screen it was printed from.
  if (report.unreconciled.length) {
    lines.push(row({}))
    for (const u of report.unreconciled) {
      lines.push(row({
        Surveyor: 'CHECK', Kind: 'DOES NOT MATCH THE FINANCE OVERVIEW PANEL',
        Vessel: u.name, 'Report #': u.field,
        'Job #': `report ${u.report}`, Client: `panel ${u.panel}`,
      }))
    }
  }

  return lines.join('\r\n')
}

export function labourReportFilename(report: LabourReport, ext: 'pdf' | 'csv'): string {
  const slug = report.periodLabel.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return `${report.withPay ? 'labour-pay-run' : 'labour-overtime'}-${slug}.${ext}`
}
