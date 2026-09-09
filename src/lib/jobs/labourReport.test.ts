// The monthly Labour & Overtime sheet — shaping and CSV.
//
// Every case here is named for the way the report can go wrong, because each one is a
// way the office is handed a number it will pay against:
//   * hours added to days (mig 148 says a job is paid by the hour OR the day, never both)
//   * a typed quantity with no shift log dropped, so the sheet silently under-reports
//     against the Finance → Overview panel it was printed from
//   * a shift that rolls past midnight landing on the wrong day, or losing its end date
//   * a km trip counted on the job's month instead of the day it was driven
//   * a date-only string parsed with new Date(), which is UTC midnight and therefore the
//     PREVIOUS day in Trinidad
//   * pay leaking into the circulate-safe variant
//
// TZ is pinned here rather than in vitest.config.ts so this file cannot change how any
// other test runs, and because CI is UTC — where the date-only bug is invisible and every
// assertion in the September cases would pass vacuously. It must happen before anything
// constructs a Date; Node re-reads process.env.TZ on assignment, and the imports below
// only *define* functions, so no Date exists yet. process.env is process-global and
// vitest can run several files in one worker, so the original is restored in afterAll.
const HOST_TZ = process.env.TZ
process.env.TZ = 'America/Port_of_Spain'

import { describe, it, expect, afterAll } from 'vitest'
import {
  buildLabourReport, labourReportCsv, labourReportFilename, labourReportPdfProps,
  periodLabelFor, type LabourShiftLine, type LabourReport,
} from './labourReport'
import type { SurveyorLabourSplit } from './labourUnit'

afterAll(() => {
  if (HOST_TZ === undefined) delete process.env.TZ
  else process.env.TZ = HOST_TZ
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

let seq = 0

/** One row as public.labour_shift_lines returns it. Defaults to the ordinary case: an
 *  hours-billed regular day shift with a real log behind it. */
function line(o: Partial<LabourShiftLine> = {}): LabourShiftLine {
  seq += 1
  return {
    line_id: `line-${seq}`,
    surveyor_id: 'S1',
    surveyor_name: 'Andrew Taylor',
    job_surveyor_id: `js-${seq}`,
    job_id: `job-${seq}`,
    job_number: 'JOB-0001',
    job_title: 'Cargo Survey',
    report_number: '26-08-263',
    vessel_name: 'Scout',
    vessel_type: 'M.V.',
    voyage_number: null,
    client_name: 'BP',
    labour_unit: 'hours',
    kind: 'regular',
    line_date: '2026-08-12',
    attribution_date: '2026-08-12',
    start_time: '08:00:00',
    end_date: null,
    end_time: '17:00:00',
    location: null,
    note: null,
    has_shift_log: true,
    evidence_only: false,
    qty: 8,
    km: 0,
    ...o,
  }
}

/** One metrics_labour row — what the Finance → Overview panel shows on screen. */
function panelRow(o: Partial<SurveyorLabourSplit> = {}): SurveyorLabourSplit {
  return {
    surveyor_id: 'S1', name: 'Andrew Taylor',
    regular_hours: 0, overtime_hours: 0, regular_days: 0, overtime_days: 0, km: 0,
    pay: [],
    ...o,
  }
}

const build = (lines: LabourShiftLine[], panel: SurveyorLabourSplit[], withPay = false): LabourReport =>
  buildLabourReport(lines, panel, { periodLabel: 'August 2026', generatedLabel: '09 Sep 2026', withPay })

/** A CSV parser only good enough for these assertions — quoted fields with doubled
 *  quotes inside, comma separated, CRLF rows. */
function parseCsv(text: string): string[][] {
  return text.split('\r\n').map(row => {
    const cells: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < row.length; i++) {
      const c = row[i]
      if (quoted) {
        if (c === '"') {
          if (row[i + 1] === '"') { cur += '"'; i++ } else quoted = false
        } else cur += c
      } else if (c === '"') quoted = true
      else if (c === ',') { cells.push(cur); cur = '' }
      else cur += c
    }
    cells.push(cur)
    return cells
  })
}

const col = (rows: string[][], name: string) => rows[0].indexOf(name)

// ── Hours vs days ────────────────────────────────────────────────────────────

describe('hours and days are never added into one number', () => {
  // A surveyor who worked an hours-billed job and a day-billed job in the same month.
  // Adding 8 hours to 1 day gives 9 of nothing, and 9 is what someone would be paid on.
  const lines = [
    line({ labour_unit: 'hours', kind: 'regular', qty: 8 }),
    line({ labour_unit: 'days', kind: 'regular', qty: 1, has_shift_log: false, start_time: null, end_time: null }),
    line({ labour_unit: 'hours', kind: 'overtime', qty: 2 }),
    line({ labour_unit: 'days', kind: 'overtime', qty: 0.5, has_shift_log: false, start_time: null, end_time: null }),
  ]
  const panel = [panelRow({ regular_hours: 8, regular_days: 1, overtime_hours: 2, overtime_days: 0.5 })]

  it('keeps the two units in separate fields and prints them side by side', () => {
    const r = build(lines, panel)
    const s = r.surveyors[0]
    expect(s.totals.regHours).toBe(8)
    expect(s.totals.regDays).toBe(1)
    expect(s.totals.otHours).toBe(2)
    expect(s.totals.otDays).toBe(0.5)
    expect(s.totalReg).toBe('8 h · 1 d')
    expect(s.totalOt).toBe('2 h · 0.5 d')
    // No path anywhere produced the collapsed 9 / 2.5.
    expect(Object.values(s.totals)).not.toContain(9)
    expect(Object.values(s.totals)).not.toContain(2.5)
    expect(s.totalReg).not.toMatch(/\b9\b/)
    expect(s.totalOt).not.toMatch(/2\.5/)
  })

  it('carries the split through the company band too', () => {
    const r = build(lines, panel)
    expect(r.company.totals).toEqual({ regHours: 8, regDays: 1, otHours: 2, otDays: 0.5, km: 0 })
    expect(r.company.totalReg).toBe('8 h · 1 d')
    expect(r.company.totalOt).toBe('2 h · 0.5 d')
  })

  it('labels each printed line with its own job unit, never the other one', () => {
    const r = build(lines, panel)
    const rows = r.surveyors[0].rows
    const hoursRow = rows.find(x => x.raw.unit === 'hours' && x.kind === 'regular')!
    const daysRow = rows.find(x => x.raw.unit === 'days' && x.kind === 'regular')!
    expect(hoursRow.reg).toBe('8h')
    expect(hoursRow.unitNoun).toBe('hours')
    expect(daysRow.reg).toBe('1d')
    expect(daysRow.unitNoun).toBe('days')
  })
})

// ── A shift that rolls past midnight ─────────────────────────────────────────

describe('a shift crossing midnight', () => {
  // 19:00 on the 20th to 03:30 on the 21st. metrics_labour counts the whole 8.5 hours on
  // the START day (job_surveyor_overtime.entry_date, mig 115); if the report split it, or
  // moved it to the 21st, the sheet would disagree with the screen.
  const overnight = line({
    kind: 'overtime', qty: 8.5,
    line_date: '2026-08-20', attribution_date: '2026-08-20',
    start_time: '19:00:00', end_date: '2026-08-21', end_time: '03:30:00',
  })
  const panel = [panelRow({ overtime_hours: 8.5 })]

  it('counts wholly on its start day', () => {
    const r = build([overnight], panel)
    const row = r.surveyors[0].rows[0]
    expect(row.dateKey).toBe('2026-08-20')
    expect(row.date).toBe('20 Aug 2026')
    expect(r.surveyors[0].totals.otHours).toBe(8.5)
    expect(r.unreconciled).toEqual([])
  })

  it('prints BOTH dates, so the office can see where the shift ended', () => {
    const r = build([overnight], panel)
    const row = r.surveyors[0].rows[0]
    expect(row.overnight).toBe(true)
    expect(row.span).toContain('19:00')
    expect(row.span).toContain('03:30')
    expect(row.spanEnd).toBe('ends 21 Aug')
    expect(row.raw.endDate).toBe('2026-08-21')
  })

  it('carries the end date into the CSV as its own sortable column', () => {
    const rows = parseCsv(labourReportCsv(build([overnight], panel)))
    const detail = rows[1]
    expect(detail[col(rows, 'Date')]).toBe('2026-08-20')
    expect(detail[col(rows, 'Shift end date')]).toBe('2026-08-21')
    expect(detail[col(rows, 'Overnight')]).toBe('yes')
    expect(detail[col(rows, 'Shift start')]).toBe('19:00')
    expect(detail[col(rows, 'Shift end')]).toBe('03:30')
  })

  it('leaves the end-date column empty for a shift that ended the same day', () => {
    const rows = parseCsv(labourReportCsv(build([line({ qty: 8 })], [panelRow({ regular_hours: 8 })])))
    expect(rows[1][col(rows, 'Shift end date')]).toBe('')
    expect(rows[1][col(rows, 'Overnight')]).toBe('')
  })
})

// ── A typed quantity with no shift log ───────────────────────────────────────

describe('a typed quantity with no shift log behind it', () => {
  // ~30% of all regular hours in this database are typed straight onto job_surveyors with
  // no job_surveyor_regular row. Drop those lines and the sheet under-reports by a third
  // while still looking complete.
  it('still produces a printed line, flagged', () => {
    const typed = line({ qty: 4, has_shift_log: false, start_time: null, end_time: null })
    const r = build([typed], [panelRow({ regular_hours: 4 })])
    const row = r.surveyors[0].rows[0]
    expect(row.flag).toBe('no shift log')
    expect(row.reg).toBe('4h')
    expect(row.span).toBe('—')
    expect(r.surveyors[0].totals.regHours).toBe(4)
  })

  it('keeps the surveyor total reconciled with the panel', () => {
    const lines = [
      line({ qty: 8 }),
      line({ qty: 4, has_shift_log: false, start_time: null, end_time: null }),
    ]
    const r = build(lines, [panelRow({ regular_hours: 12 })])
    expect(r.surveyors[0].totals.regHours).toBe(12)
    expect(r.unreconciled).toEqual([])
  })

  it('calls a day-billed line a typed day count, never "no shift log"', () => {
    // On a day-billed job the payable quantity is ALWAYS typed — the shifts are logged
    // separately as evidence. Printing "no shift log" over it was a false statement about
    // the database on a document the office checks against the database.
    const typed = line({ labour_unit: 'days', qty: 2, has_shift_log: false, start_time: null, end_time: null })
    const r = build([typed], [panelRow({ regular_days: 2 })])
    const row = r.surveyors[0].rows[0]
    expect(row.flag).toBe('typed day count')
    expect(row.flag).not.toContain('no shift log')
    expect(r.surveyors[0].totals.regDays).toBe(2)
    expect(r.surveyors[0].totals.regHours).toBe(0)
  })

  it('marks it NO SHIFT LOG in the CSV, not a blank cell someone reads as "none"', () => {
    const typed = line({ qty: 4, has_shift_log: false, start_time: null, end_time: null })
    const rows = parseCsv(labourReportCsv(build([typed], [panelRow({ regular_hours: 4 })])))
    expect(rows[1][col(rows, 'Shift log')]).toBe('NO SHIFT LOG')
  })

  it('emits a hand-edited negative residual rather than clamping it away', () => {
    // job_surveyors.regular_hours edited below the sum of its own shift log. Clamping the
    // difference to zero would break the reconciliation identity silently — which is the
    // one failure this whole report exists to prevent.
    const lines = [
      line({ qty: 8 }),
      line({ qty: -1.5, has_shift_log: false, start_time: null, end_time: null }),
    ]
    const r = build(lines, [panelRow({ regular_hours: 6.5 })])
    expect(r.surveyors[0].totals.regHours).toBe(6.5)
    expect(r.surveyors[0].rows.some(x => x.reg === '-1.5h')).toBe(true)
    expect(r.unreconciled).toEqual([])
  })
})

// ── A day-billed job's shift log ─────────────────────────────────────────────

describe("a day-billed job's logged shifts", () => {
  // The job page logs shifts on a day-billed job too, and says so on screen: "shifts here
  // are a record of the hours worked, not the payable quantity". If the report drops them,
  // the shift-by-shift sheet has NO dated lines for exactly the jobs whose days the office
  // most needs to check — one undated line saying 3 days, and nothing to check it against.
  const evidence = (o: Partial<LabourShiftLine> = {}) => line({
    labour_unit: 'days', kind: 'regular', qty: 0, evidence_only: true, has_shift_log: true,
    start_time: '07:00:00', end_time: '19:00:00', ...o,
  })
  const typed = line({
    labour_unit: 'days', kind: 'regular', qty: 3, has_shift_log: false,
    start_time: null, end_time: null, line_date: '2026-08-12',
  })

  it('prints every shift, with its date and its times', () => {
    const lines = [
      evidence({ line_date: '2026-08-12' }),
      evidence({ line_date: '2026-08-13' }),
      evidence({ line_date: '2026-08-14' }),
      typed,
    ]
    const r = build(lines, [panelRow({ regular_days: 3 })])
    const dated = r.surveyors[0].rows.filter(x => x.raw.evidenceOnly)
    expect(dated.map(x => x.dateKey)).toEqual(['2026-08-12', '2026-08-13', '2026-08-14'])
    for (const d of dated) expect(d.span).toContain('07:00')
  })

  it('is worth nothing — the typed day count is still the whole quantity', () => {
    const r = build([evidence(), typed], [panelRow({ regular_days: 3 })])
    expect(r.surveyors[0].totals.regDays).toBe(3)
    expect(r.surveyors[0].totals.regHours).toBe(0)
    expect(r.unreconciled).toEqual([])
  })

  it('says what it is, instead of claiming no shift was logged', () => {
    const r = build([evidence(), typed], [panelRow({ regular_days: 3 })])
    const row = r.surveyors[0].rows.find(x => x.raw.evidenceOnly)!
    expect(row.flag).toBe('shift record, not payable')
    expect(row.reg).toBe('—')
    const rows = parseCsv(labourReportCsv(build([evidence(), typed], [panelRow({ regular_days: 3 })])))
    const log = col(rows, 'Shift log')
    expect(rows.slice(1).map(r2 => r2[log])).toContain('RECORD ONLY')
  })

  it('counts as a shift; a typed quantity does not', () => {
    // The header chip must not contradict the rows under it by counting lines that say,
    // in their own flag, that no shift was recorded.
    const r = build([evidence(), evidence(), typed], [panelRow({ regular_days: 3 })])
    expect(r.surveyors[0].shiftCount).toBe(2)
    const hours = build(
      [line({ qty: 8 }), line({ qty: 4, has_shift_log: false, start_time: null, end_time: null })],
      [panelRow({ regular_hours: 12 })],
    )
    expect(hours.surveyors[0].shiftCount).toBe(1)
  })
})

// ── Adding the lines up by hand ──────────────────────────────────────────────

describe('the printed lines add up to the printed subtotal', () => {
  // A shift is stored to two decimals (shiftHours, mig 157). Printing each line to ONE
  // and the subtotal from the unrounded values is how a sheet ends up with three lines of
  // 9.3 under a subtotal of 28 — on the one document whose whole purpose is being added
  // up by hand.
  it('prints a two-decimal shift as itself, not rounded away from its own total', () => {
    const lines = [line({ qty: 9.33 }), line({ qty: 9.33 }), line({ qty: 9.33 })]
    const r = build(lines, [panelRow({ regular_hours: 27.99 })])
    const s2 = r.surveyors[0]
    expect(s2.rows.map(x => x.reg)).toEqual(['9.33h', '9.33h', '9.33h'])
    expect(s2.totalReg).toBe('27.99 h')
    expect(r.company.totalReg).toBe('27.99 h')
    expect(r.unreconciled).toEqual([])
  })

  it('still writes a whole number as a whole number', () => {
    const r = build([line({ qty: 8 })], [panelRow({ regular_hours: 8 })])
    expect(r.surveyors[0].rows[0].reg).toBe('8h')
    expect(r.surveyors[0].totalReg).toBe('8 h')
  })
})

// ── Km ───────────────────────────────────────────────────────────────────────

describe('a km trip', () => {
  // metrics_labour counts a trip on job_surveyor_km.trip_date, not on the job's month, so
  // a trip driven on 2 September for an August job belongs to September's km — and the
  // report must place it on the same day or the two disagree.
  const trip = line({
    kind: 'km', qty: 0, km: 45,
    line_date: '2026-09-02', attribution_date: '2026-09-02',
    start_time: null, end_time: null,
  })

  it('counts on the day it was driven, not the job month', () => {
    const r = build([trip], [panelRow({ km: 45 })])
    const row = r.surveyors[0].rows[0]
    expect(row.dateKey).toBe('2026-09-02')
    expect(row.date).toBe('02 Sep 2026')
    expect(r.surveyors[0].totals.km).toBe(45)
    expect(r.unreconciled).toEqual([])
  })

  it('never lands in a labour quantity', () => {
    const r = build([trip], [panelRow({ km: 45 })])
    const s = r.surveyors[0]
    expect(s.totals).toEqual({ regHours: 0, regDays: 0, otHours: 0, otDays: 0, km: 45 })
    const row = s.rows[0]
    expect(row.reg).toBe('—')
    expect(row.ot).toBe('—')
    expect(row.km).toBe('45 km')
    expect(row.span).toBe('travel')
  })

  it('is not counted as a shift', () => {
    const r = build([line({ qty: 8 }), trip], [panelRow({ regular_hours: 8, km: 45 })])
    expect(r.surveyors[0].shiftCount).toBe(1)
  })

  it('sorts after the shifts of the same day', () => {
    const sameDay = line({ kind: 'km', qty: 0, km: 12, line_date: '2026-08-12', attribution_date: '2026-08-12', start_time: null, end_time: null })
    const r = build([sameDay, line({ qty: 8 })], [panelRow({ regular_hours: 8, km: 12 })])
    expect(r.surveyors[0].rows.map(x => x.kind)).toEqual(['regular', 'km'])
  })
})

// ── Date-only strings ────────────────────────────────────────────────────────

describe('a date-only string never round-trips through new Date()', () => {
  // new Date('2026-09-01') is UTC midnight — 31 Aug 20:00 in Trinidad — so a job dated the
  // 1st lands in the previous month. The whole file is pinned to the company timezone so
  // this case cannot pass vacuously on CI.
  it('keeps a job dated the 1st in its own month', () => {
    const first = line({ line_date: '2026-09-01', attribution_date: '2026-09-01', qty: 8 })
    const r = build([first], [panelRow({ regular_hours: 8 })])
    const row = r.surveyors[0].rows[0]
    expect(row.date).toBe('01 Sep 2026')
    expect(row.dateKey).toBe('2026-09-01')
    expect(row.raw.lineDate).toBe('2026-09-01')
  })

  it('writes the raw YYYY-MM-DD into the CSV so Excel sorts and filters it', () => {
    const first = line({ line_date: '2026-09-01', attribution_date: '2026-09-01', qty: 8 })
    const rows = parseCsv(labourReportCsv(build([first], [panelRow({ regular_hours: 8 })])))
    expect(rows[1][col(rows, 'Date')]).toBe('2026-09-01')
  })

  it('labels the period from the month string without constructing a UTC midnight', () => {
    expect(periodLabelFor('month', '2026-09', '2026')).toBe('September 2026')
    expect(periodLabelFor('month', '2026-01', '2026')).toBe('January 2026')
    expect(periodLabelFor('year', '2026-09', '2026')).toBe('2026')
    expect(periodLabelFor('all', '2026-09', '2026')).toBe('All time')
  })

  it('prints an end date that fell on the 1st on the 1st', () => {
    const rollover = line({
      kind: 'overtime', qty: 6,
      line_date: '2026-08-31', attribution_date: '2026-08-31',
      start_time: '20:00:00', end_date: '2026-09-01', end_time: '02:00:00',
    })
    const r = build([rollover], [panelRow({ overtime_hours: 6 })])
    expect(r.surveyors[0].rows[0].spanEnd).toBe('ends 01 Sep')
  })
})

// ── Reconciliation with the panel ────────────────────────────────────────────

describe('reconciliation against Finance → Overview', () => {
  const lines = [
    line({ qty: 8 }),
    line({ kind: 'overtime', qty: 3 }),
    line({ labour_unit: 'days', kind: 'regular', qty: 2, has_shift_log: false, start_time: null, end_time: null }),
    line({ kind: 'km', qty: 0, km: 40, start_time: null, end_time: null }),
  ]

  it('is silent when every total matches', () => {
    const panel = [panelRow({ regular_hours: 8, overtime_hours: 3, regular_days: 2, km: 40 })]
    expect(build(lines, panel).unreconciled).toEqual([])
  })

  it('names the exact field, and both numbers, when one disagrees', () => {
    const panel = [panelRow({ regular_hours: 8.5, overtime_hours: 3, regular_days: 2, km: 40 })]
    const r = build(lines, panel)
    expect(r.unreconciled).toEqual([
      { surveyorId: 'S1', name: 'Andrew Taylor', field: 'regular hours', report: 8, panel: 8.5 },
    ])
  })

  it('puts the disagreement on the document itself, not only in a log', () => {
    const panel = [panelRow({ regular_hours: 8.5, overtime_hours: 3, regular_days: 2, km: 40 })]
    const r = build(lines, panel)
    const props = labourReportPdfProps(r)
    expect(props.warnings).toHaveLength(1)
    expect(props.warnings[0]).toContain('Andrew Taylor')
    expect(props.warnings[0]).toContain('regular hours')
    const csv = labourReportCsv(r)
    expect(csv).toContain('CHECK')
    expect(csv).toContain('report 8')
    expect(csv).toContain('panel 8.5')
  })

  it('reports a surveyor the panel shows but the shift lines do not', () => {
    const r = build([], [panelRow({ surveyor_id: 'S9', name: 'Narin Ramroop', regular_hours: 12 })])
    expect(r.surveyors.map(s => s.surveyorId)).toEqual(['S9'])
    expect(r.surveyors[0].totals.regHours).toBe(0)
    expect(r.unreconciled).toEqual([
      { surveyorId: 'S9', name: 'Narin Ramroop', field: 'regular hours', report: 0, panel: 12 },
    ])
  })

  it('reports a surveyor the shift lines show but the panel does not', () => {
    const orphan = line({ surveyor_id: 'S8', surveyor_name: 'Kavi Singh', qty: 5 })
    const r = build([orphan], [panelRow({ regular_hours: 8 })])
    expect(r.surveyors.map(s => s.surveyorId)).toEqual(['S1', 'S8'])
    expect(r.surveyors[1].name).toBe('Kavi Singh')
    expect(r.unreconciled.some(u => u.surveyorId === 'S8' && u.field === 'regular hours' && u.report === 5 && u.panel === 0)).toBe(true)
  })

  it('ignores float noise below half a hundredth', () => {
    const panel = [panelRow({ regular_hours: 8.002, overtime_hours: 3, regular_days: 2, km: 40 })]
    expect(build(lines, panel).unreconciled).toEqual([])
  })
})

// ── CSV ──────────────────────────────────────────────────────────────────────

describe('the CSV', () => {
  const lines = [
    line({ labour_unit: 'hours', kind: 'regular', qty: 8 }),
    line({ labour_unit: 'hours', kind: 'overtime', qty: 3 }),
    line({ labour_unit: 'days', kind: 'regular', qty: 2, has_shift_log: false, start_time: null, end_time: null }),
    line({ labour_unit: 'days', kind: 'overtime', qty: 1, has_shift_log: false, start_time: null, end_time: null }),
    line({ kind: 'km', qty: 0, km: 40, start_time: null, end_time: null }),
  ]
  const panel = [panelRow({ regular_hours: 8, overtime_hours: 3, regular_days: 2, overtime_days: 1, km: 40 })]

  it('carries the unit on every detail row so no cell is a bare unlabelled number', () => {
    const rows = parseCsv(labourReportCsv(build(lines, panel)))
    const u = col(rows, 'Unit')
    const detail = rows.slice(1).filter(r2 => /^(regular|overtime|km)$/.test(r2[col(rows, 'Kind')]))
    expect(detail).toHaveLength(5)
    for (const r2 of detail) expect(['hours', 'days']).toContain(r2[u])
  })

  it('writes bare summable numbers, never a "8h" Excel cannot add', () => {
    const rows = parseCsv(labourReportCsv(build(lines, panel)))
    const reg = col(rows, 'Regular hours')
    const values = rows.slice(1).map(r2 => r2[reg]).filter(Boolean)
    expect(values).not.toHaveLength(0)
    for (const v of values) expect(v).toMatch(/^-?[0-9.]+$/)
  })

  it('never lets one column hold both an hours quantity and a days one', () => {
    // The office selects a column and reads Excel's status bar. If hours and days shared
    // one column that sum would be 8 hours + 2 days = 10 of nothing — the exact operation
    // migration 148 exists to prevent. The Unit column is prose; these columns are the
    // thing that makes the wrong sum impossible to take.
    const rows = parseCsv(labourReportCsv(build(lines, panel)))
    const unit = col(rows, 'Unit')
    const rh = col(rows, 'Regular hours')
    const rd = col(rows, 'Regular days')
    const oh = col(rows, 'Overtime hours')
    const od = col(rows, 'Overtime days')
    expect([rh, rd, oh, od].every(i => i >= 0)).toBe(true)
    expect(rows[0]).not.toContain('Regular qty')
    for (const r2 of rows.slice(1)) {
      if (r2[unit] === 'hours') expect([r2[rd], r2[od]]).toEqual(['', ''])
      if (r2[unit] === 'days') expect([r2[rh], r2[oh]]).toEqual(['', ''])
    }
  })

  it('never writes one combined total across the two units', () => {
    const csv = labourReportCsv(build(lines, panel))
    const rows = parseCsv(csv)
    const kind = col(rows, 'Kind')
    const unit = col(rows, 'Unit')
    const rh = col(rows, 'Regular hours')
    const rd = col(rows, 'Regular days')
    const oh = col(rows, 'Overtime hours')
    const od = col(rows, 'Overtime days')
    const km = col(rows, 'Km')

    const totals = rows.filter(r2 => r2[kind].startsWith('TOTAL ('))
    expect(totals.map(r2 => r2[kind])).toEqual(['TOTAL (hours)', 'TOTAL (days)'])
    const hoursTotal = totals.find(r2 => r2[kind] === 'TOTAL (hours)')!
    const daysTotal = totals.find(r2 => r2[kind] === 'TOTAL (days)')!
    expect(hoursTotal[unit]).toBe('hours')
    expect(hoursTotal[rh]).toBe('8')
    expect(hoursTotal[oh]).toBe('3')
    expect([hoursTotal[rd], hoursTotal[od]]).toEqual(['', ''])
    expect(daysTotal[unit]).toBe('days')
    expect(daysTotal[rd]).toBe('2')
    expect(daysTotal[od]).toBe('1')
    expect([daysTotal[rh], daysTotal[oh]]).toEqual(['', ''])
    // 8 + 2 and 3 + 1 exist nowhere.
    expect(totals.map(r2 => r2[rh])).not.toContain('10')
    expect(totals.map(r2 => r2[oh])).not.toContain('4')
    // Km rides the hours row only, so a spreadsheet cannot count it twice.
    expect(hoursTotal[km]).toBe('40')
    expect(daysTotal[km]).toBe('')

    const subs = rows.filter(r2 => r2[kind].startsWith('SUBTOTAL ('))
    expect(subs.map(r2 => r2[kind])).toEqual(['SUBTOTAL (hours)', 'SUBTOTAL (days)'])
  })

  it('escapes a client name carrying a comma or a quote', () => {
    const awkward = [
      line({ client_name: 'Massy Wood Group, Ltd.', qty: 8 }),
      line({ client_name: 'The "Deck" Company', qty: 1 }),
    ]
    const csv = labourReportCsv(build(awkward, [panelRow({ regular_hours: 9 })]))
    expect(csv).toContain('"Massy Wood Group, Ltd."')
    expect(csv).toContain('"The ""Deck"" Company"')
    const rows = parseCsv(csv)
    const c = col(rows, 'Client')
    expect(rows[1][c]).toBe('Massy Wood Group, Ltd.')
    expect(rows[2][c]).toBe('The "Deck" Company')
  })

  it('prints the same rows, in the same order, as the PDF', () => {
    const report = build(lines, panel)
    const rows = parseCsv(labourReportCsv(report))
    const kind = col(rows, 'Kind')
    const csvOrder = rows.slice(1)
      .filter(r2 => /^(regular|overtime|km)$/.test(r2[kind]))
      .map(r2 => r2[kind])
    expect(csvOrder).toEqual(report.surveyors[0].rows.map(r2 => r2.kind))
  })
})

// ── Pay ──────────────────────────────────────────────────────────────────────

describe('the quantities-only variant', () => {
  const lines = [line({ qty: 8 })]
  const panel = [panelRow({ regular_hours: 8, pay: [{ currency: 'USD', total: 495 }] })]

  it('carries no pay anywhere, even though the panel it was built from has some', () => {
    const r = build(lines, panel, false)
    expect(r.withPay).toBe(false)
    expect(r.surveyors[0].pay).toEqual([])
    expect(r.surveyors[0].payLabel).toBe('')
    expect(r.company.pay).toEqual([])
    expect(r.company.payLabel).toBe('')
    expect(JSON.stringify(r)).not.toContain('USD')
    expect(JSON.stringify(r)).not.toContain('495')
  })

  it('gives the renderer nothing pay-shaped to print', () => {
    const props = labourReportPdfProps(build(lines, panel, false))
    expect(props.withPay).toBe(false)
    expect(props.companyPayLabel).toBe('')
    expect(props.surveyors[0].payLabel).toBe('')
    expect(JSON.stringify(props)).not.toContain('USD')
  })

  it('has no Pay or Currency column in the CSV at all', () => {
    const csv = labourReportCsv(build(lines, panel, false))
    const header = parseCsv(csv)[0]
    expect(header).not.toContain('Pay')
    expect(header).not.toContain('Currency')
    expect(csv).not.toContain('USD')
    expect(csv).not.toContain('SUBTOTAL (pay)')
  })
})

describe('the pay-run variant', () => {
  const lines = [line({ qty: 8 })]
  const twoCurrencies = [panelRow({
    regular_hours: 8,
    pay: [{ currency: 'USD', total: 495 }, { currency: 'TTD', total: 1200 }],
  })]

  it('writes each currency out, never their sum', () => {
    const r = build(lines, twoCurrencies, true)
    expect(r.surveyors[0].payLabel).toBe('USD 495.00 · TTD 1,200.00')
    expect(r.company.payLabel).toBe('USD 495.00 · TTD 1,200.00')
    // 495 + 1200 is meaningless and must not exist.
    expect(r.surveyors[0].payLabel).not.toContain('1,695')
    expect(r.company.pay.map(p => p.total)).toEqual([495, 1200])
  })

  it('gives every CSV pay cell one currency of its own', () => {
    const rows = parseCsv(labourReportCsv(build(lines, twoCurrencies, true)))
    const kind = col(rows, 'Kind')
    const cur = col(rows, 'Currency')
    const pay = col(rows, 'Pay')
    const subs = rows.filter(r2 => r2[kind] === 'SUBTOTAL (pay)')
    expect(subs.map(r2 => [r2[cur], r2[pay]])).toEqual([['USD', '495'], ['TTD', '1200']])
    const tot = rows.filter(r2 => r2[kind] === 'TOTAL (pay)')
    expect(tot.map(r2 => [r2[cur], r2[pay]])).toEqual([['USD', '495'], ['TTD', '1200']])
    // Never one row holding both currencies' money.
    expect(rows.every(r2 => r2[pay] !== '1695')).toBe(true)
  })

  it('adds one currency across surveyors but never across currencies', () => {
    const two = [
      line({ surveyor_id: 'S1', qty: 8 }),
      line({ surveyor_id: 'S2', surveyor_name: 'Narin Ramroop', qty: 6 }),
    ]
    const panel = [
      panelRow({ surveyor_id: 'S1', regular_hours: 8, pay: [{ currency: 'USD', total: 400 }] }),
      panelRow({ surveyor_id: 'S2', name: 'Narin Ramroop', regular_hours: 6, pay: [{ currency: 'USD', total: 300 }, { currency: 'TTD', total: 500 }] }),
    ]
    const r = build(two, panel, true)
    expect(r.company.pay).toEqual([{ currency: 'USD', total: 700 }, { currency: 'TTD', total: 500 }])
    expect(r.company.payLabel).toBe('USD 700.00 · TTD 500.00')
  })
})

// ── Filenames ────────────────────────────────────────────────────────────────

describe('the delivered filename', () => {
  it('says which variant it is, so a pay run is never mistaken for the circulate-safe sheet', () => {
    const lines = [line({ qty: 8 })]
    const panel = [panelRow({ regular_hours: 8 })]
    expect(labourReportFilename(build(lines, panel, false), 'pdf')).toBe('labour-overtime-august-2026.pdf')
    expect(labourReportFilename(build(lines, panel, true), 'pdf')).toBe('labour-pay-run-august-2026.pdf')
    expect(labourReportFilename(build(lines, panel, false), 'csv')).toBe('labour-overtime-august-2026.csv')
  })

  it('slugs a period label that is not a month', () => {
    const r = buildLabourReport([], [], { periodLabel: 'All time', generatedLabel: '09 Sep 2026', withPay: false })
    expect(labourReportFilename(r, 'csv')).toBe('labour-overtime-all-time.csv')
  })
})

// ── Ordering ─────────────────────────────────────────────────────────────────

describe('the order the sheet reads in', () => {
  it('mirrors the panel, so the sheet and the screen list people the same way', () => {
    const lines = [
      line({ surveyor_id: 'S2', surveyor_name: 'Narin Ramroop', qty: 6 }),
      line({ surveyor_id: 'S1', qty: 8 }),
    ]
    const panel = [
      panelRow({ surveyor_id: 'S2', name: 'Narin Ramroop', regular_hours: 6 }),
      panelRow({ surveyor_id: 'S1', regular_hours: 8 }),
    ]
    expect(build(lines, panel).surveyors.map(s => s.name)).toEqual(['Narin Ramroop', 'Andrew Taylor'])
  })

  it('is fully deterministic within a surveyor: date, then kind, then start time', () => {
    const lines = [
      line({ line_date: '2026-08-13', attribution_date: '2026-08-13', kind: 'km', qty: 0, km: 20, start_time: null, end_time: null }),
      line({ line_date: '2026-08-13', attribution_date: '2026-08-13', kind: 'overtime', qty: 2, start_time: '18:00:00', end_time: '20:00:00' }),
      line({ line_date: '2026-08-12', attribution_date: '2026-08-12', qty: 4, start_time: '13:00:00', end_time: '17:00:00' }),
      line({ line_date: '2026-08-12', attribution_date: '2026-08-12', qty: 4, start_time: '08:00:00', end_time: '12:00:00' }),
      line({ line_date: '2026-08-12', attribution_date: '2026-08-12', qty: 1, has_shift_log: false, start_time: null, end_time: null }),
    ]
    const r = build(lines, [panelRow({ regular_hours: 9, overtime_hours: 2, km: 20 })])
    expect(r.surveyors[0].rows.map(x => `${x.dateKey} ${x.kind} ${x.raw.startTime ?? '-'}`)).toEqual([
      '2026-08-12 regular 08:00',
      '2026-08-12 regular 13:00',
      // A typed line with no time sorts AFTER the logged shifts of the same day, never
      // above them — punctuation sentinels do not order reliably under localeCompare.
      '2026-08-12 regular -',
      '2026-08-13 overtime 18:00',
      '2026-08-13 km -',
    ])
  })
})

// ── Vessel / job identity on each line ───────────────────────────────────────

describe('each line says which vessel and job it was', () => {
  it('prefixes the vessel and carries its voyage', () => {
    const l = line({ vessel_name: 'Delta Vanguard', vessel_type: 'M.T.', voyage_number: 'V-104' })
    const r = build([l], [panelRow({ regular_hours: 8 })])
    expect(r.surveyors[0].rows[0].vessel).toBe('M.T. Delta Vanguard (V-104)')
  })

  it('falls back to the job title when a job has no vessel at all', () => {
    const l = line({ vessel_name: null, job_title: 'Draught Survey' })
    const r = build([l], [panelRow({ regular_hours: 8 })])
    expect(r.surveyors[0].rows[0].vessel).toBe('Draught Survey')
  })

  it('prefers the report number over the job number, and keeps both in the CSV', () => {
    const l = line({ report_number: '26-08-263', job_number: 'JOB-0001' })
    const report = build([l], [panelRow({ regular_hours: 8 })])
    expect(report.surveyors[0].rows[0].job).toBe('26-08-263')
    const rows = parseCsv(labourReportCsv(report))
    expect(rows[1][col(rows, 'Report #')]).toBe('26-08-263')
    expect(rows[1][col(rows, 'Job #')]).toBe('JOB-0001')
  })

  it('falls back to the job number when a job carries no report number', () => {
    const l = line({ report_number: null, job_number: 'JOB-0042' })
    const r = build([l], [panelRow({ regular_hours: 8 })])
    expect(r.surveyors[0].rows[0].job).toBe('JOB-0042')
  })
})
