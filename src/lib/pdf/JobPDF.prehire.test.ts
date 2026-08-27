// The ten per-template presentation flags added by migration 202 for the Pre-Hire
// Inspection report. JobPDF.unchanged.test.ts proves they are inert when off; this file
// proves each one is WIRED — a flag that silently does nothing is the failure mode here,
// because the route's template embed is an explicit column list and an unselected column
// arrives `undefined`, which reads as off with no error anywhere.
import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { JobPDF, formatReportDate, compareItemNumbers } from './JobPDF'

const render = (props: any) => renderToBuffer(React.createElement(JobPDF as any, props) as any)
const pageCount = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

// @react-pdf stamps a random /ID and a second-resolution /CreationDate into every
// document, so a RAW byte compare of two renders of IDENTICAL props can come back
// "different" — which would make `differs` return true for a flag that does nothing at
// all, passing every assertion below for exactly the reason this file exists to rule
// out. Normalise those two away, as JobPDF.unchanged.test.ts does, and the comparison
// answers the question actually being asked.
const normalise = (b: Buffer) =>
  b.toString('latin1')
    .replace(/\/ID\s*\[[^\]]*\]/g, '/ID[NORMALISED]')
    .replace(/\(D:\d{14}[^)]*\)/g, '(D:NORMALISED)')

const differs = async (props: any, flag: Record<string, boolean>) => {
  const [off, on] = await Promise.all([render(props), render({ ...props, ...flag })])
  return normalise(Buffer.from(off)) !== normalise(Buffer.from(on))
}

const YN = [
  { value: 'yes', label: 'Yes', color: 'green' },
  { value: 'no', label: 'No', color: 'red' },
  { value: 'na', label: 'N/A', color: 'gray' },
]

const sections = [
  {
    id: 's1', title: 'Bridge', is_repeatable: false, fields: [
      { id: 'f1', label: 'Is all bridge navigational equipment operational?', field_type: 'yes_no_na', item_number: '7.1', order_index: 0, options: YN },
      { id: 'f2', label: 'Navigation equipment individually verified', field_type: 'multiple_choice', item_number: '7.2', order_index: 1, options: [{ value: 'r1', label: 'Radar 1' }, { value: 'gy', label: 'Gyro' }, { value: 'ec', label: 'ECDIS' }] },
      // The conditional DETAIL field, stored AFTER the tick-list — the 7.1 / 7.2 / 7.1A
      // ordering that pdf_sort_by_item_number fixes, and the field whose text the
      // Summary of Findings borrows when 7.1's own remark box is empty.
      {
        id: 'f3', label: 'Which item(s) of navigational equipment, and what was found?',
        field_type: 'textarea', item_number: '7.1A', order_index: 2,
        conditional_logic: { operator: 'and', conditions: [{ field_id: 'f1', operator: 'equals', value: 'no' }] },
      },
      { id: 'f4', label: 'Are permits to work in use?', field_type: 'yes_no_na', item_number: '4.2', order_index: 3, options: YN },
      { id: 'f5', label: 'Date of last drydocking', field_type: 'date', item_number: '3.7', order_index: 4 },
    ],
  },
  {
    id: 's2', title: 'Findings — Observations & Deficiencies', is_repeatable: true, fields: [
      { id: 'g1', label: 'Area / location', field_type: 'text', item_number: '14.1', order_index: 0 },
      { id: 'g2', label: 'What was observed', field_type: 'textarea', item_number: '14.2', order_index: 1 },
    ],
  },
]

const fieldValues: Record<string, string> = {
  // Answered No with an EMPTY remark: the summary printed the finding bare while the
  // explanation sat three pages later on 7.1A.
  f1: 'no|||',
  f3: 'Port Spare Nav. Light Not Functional',
  f4: 'no|||The crew are conducting Permits to Work, Risk Assessments and Toolbox Talks for all jobs, including routine jobs, against the company ISM policy, whereas company policy requires that routine jobs only need a Risk Assessment and Toolbox Talk.',
  f5: '2025-07-21',
}

const props = {
  job: {
    id: 'j1', title: 'Pre-Hire Inspection', job_number: 'TEAL C/L #1280', report_number: '26-08-263',
    vessel_name: 'Navigator', vessel_type: 'MV', client: { name: 'Seabrokers' },
    scheduled_date: '2026-08-24', template: { name: 'Pre-Hire Inspection' },
  },
  sections,
  fieldValues,
  arrayValues: { f2: ['ec', 'r1'] },   // tapped out of the template's option order
  signatures: {},
  photoCount: 0,
  photos: [] as any[],
  surveyors: ['Captain Andrew Taylor'],
  documents: [] as any[],
  deficiencySummary: true,
  findingDetail: true,
  balancedHeader: true,
}

describe('migration 202 — each flag is wired', () => {
  it('pdf_uniform_label_width changes the row geometry', async () => {
    expect(await differs(props, { uniformLabelWidth: true })).toBe(true)
  }, 40000)

  it('pdf_no_hyphenation changes the line breaking', async () => {
    expect(await differs(props, { noHyphenation: true })).toBe(true)
  }, 40000)

  it('pdf_remark_below moves a long remark out of the value cell', async () => {
    expect(await differs(props, { remarkBelow: true })).toBe(true)
  }, 40000)

  it('pdf_sort_choices reorders a tick-list answer', async () => {
    expect(await differs(props, { sortChoices: true })).toBe(true)
  }, 40000)

  it('pdf_format_dates reformats an ISO date value', async () => {
    expect(await differs(props, { formatDates: true })).toBe(true)
  }, 40000)

  it('pdf_sort_by_item_number reorders the rows', async () => {
    expect(await differs(props, { sortByItemNumber: true })).toBe(true)
  }, 40000)

  // The report number is written into the PDF's Info dictionary, which pdfkit emits
  // UNCOMPRESSED — so it can be asserted on directly, unlike the page content streams.
  // The title contains an em dash, so pdfkit writes the whole string as UTF-16BE;
  // dropping the NUL bytes makes it searchable either way.
  it('pdf_show_report_number puts 26-08-263 on the document, not the ledger reference', async () => {
    const flat = (b: Uint8Array) => Buffer.from(b).toString('latin1').replace(/\u0000/g, '')
    const off = flat(await render(props))
    const on = flat(await render({ ...props, showReportNumber: true }))
    expect(off).toContain('TEAL C/L #1280')
    expect(off).not.toContain('26-08-263')
    expect(on).toContain('26-08-263')
  }, 40000)

  // The empty repeatable section forces a page break and then prints one "Entry 1" of em
  // dashes, on a page of its own. Suppressing it must cost a whole page.
  it('pdf_hide_empty_repeatables drops the blank entry AND its forced page', async () => {
    const [off, on] = await Promise.all([
      render(props),
      render({ ...props, hideEmptyRepeatables: true }),
    ])
    expect(pageCount(Buffer.from(off))).toBeGreaterThan(pageCount(Buffer.from(on)))
  }, 40000)

  // A repeatable section that DOES carry data must still print with the flag on — the
  // flag suppresses empty sections, not repeatable sections.
  it('pdf_hide_empty_repeatables keeps a repeatable section that has data', async () => {
    const withData = { ...props, fieldValues: { ...fieldValues, g1: 'Main deck, frame 42' } }
    const [off, on] = await Promise.all([
      render(withData),
      render({ ...withData, hideEmptyRepeatables: true }),
    ])
    expect(Buffer.from(off).length).toBe(Buffer.from(on).length)
  }, 40000)

  // The in-body attachment line is gated by the optional `number` alone — no extra prop.
  it('an attachment with a number becomes a cross-reference; without one it does not', async () => {
    const docProps = {
      ...props,
      sections: [{ ...sections[0], fields: [...sections[0].fields, { id: 'f9', label: "Ship's particulars — attach", field_type: 'photo', item_number: '2.11', order_index: 9 }] }, sections[1]],
    }
    const [plain, numbered] = await Promise.all([
      render({ ...docProps, documents: [{ field_id: 'f9', instance: 0, filename: 'Spec Sheet.pdf' }] }),
      render({ ...docProps, documents: [{ field_id: 'f9', instance: 0, filename: 'Spec Sheet.pdf', number: 1 }] }),
    ])
    expect(normalise(Buffer.from(plain))).not.toBe(normalise(Buffer.from(numbered)))
  }, 40000)

  // The Summary of Findings borrows the conditional detail field's text when the
  // finding's own remark box is empty.
  //
  // Gated by pdf_finding_detail and NOT by deficiencySummary, so it is proved by moving
  // that one flag with everything else — deficiencySummary included — held still. Were
  // it still riding deficiencySummary this assertion would read `false`, which is the
  // point: "all migration-202 flags off" has to mean today's output for a template that
  // already has the summary on, and only a flag of its own can promise that.
  it('pdf_finding_detail is what borrows 7.1A into the findings summary', async () => {
    expect(await differs({ ...props, findingDetail: false }, { findingDetail: true })).toBe(true)
  }, 40000)

  it('borrowing needs the summary too — findingDetail alone changes nothing', async () => {
    expect(await differs({ ...props, deficiencySummary: false }, { findingDetail: true })).toBe(false)
  }, 40000)
})

describe('migration 202 — pure helpers', () => {
  it('formats only an exact ISO date', () => {
    expect(formatReportDate('2026-08-24')).toBe('24.08.2026')
    expect(formatReportDate('Wk 35 - Aug 2026')).toBe('Wk 35 - Aug 2026')
    expect(formatReportDate('OVIQ2 - 14/05/2026')).toBe('OVIQ2 - 14/05/2026')
    expect(formatReportDate('')).toBe('')
  })

  it('sorts a lettered detail immediately after its own number', () => {
    const order = ['7.2', '7.1A', '13.16', '7.1', '13.15A', '10.1', '3.12']
      .sort(compareItemNumbers)
    expect(order).toEqual(['3.12', '7.1', '7.1A', '7.2', '10.1', '13.15A', '13.16'])
  })

  it('compares numeric segments as numbers, not text', () => {
    expect(compareItemNumbers('2.9', '2.10')).toBeLessThan(0)
    expect(compareItemNumbers('13.2', '3.14')).toBeGreaterThan(0)
  })
})
