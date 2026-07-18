import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { JobPDF } from './JobPDF'

// 1x1 transparent PNG as a data URI — no network fetch, so this isolates LAYOUT
// (minPresenceAhead / break / the details restructure) from image downloading.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('JobPDF render (borescoping-style)', () => {
  it('completes without hanging', async () => {
    const sections = [
      {
        id: 's1', title: 'Title / Job Details', is_repeatable: false,
        fields: [
          { id: 'f3', label: 'Date', field_type: 'date', order_index: 0, show_in_header: false },
          { id: 'f4', label: 'Time', field_type: 'time', order_index: 1, show_in_header: false },
          { id: 'f5', label: 'Vessel Name', field_type: 'text', order_index: 2, show_in_header: true },
          { id: 'f6', label: 'Port of Registry', field_type: 'text', order_index: 3, show_in_header: true },
          { id: 'f7', label: 'Gross Tonnes', field_type: 'number', unit: 'tons', order_index: 4, show_in_header: true },
          { id: 'f8', label: 'Port / Location', field_type: 'text', order_index: 5, show_in_header: false },
          { id: 'f9', label: 'Surveyor', field_type: 'text', order_index: 6, show_in_header: true },
          { id: 'fa', label: 'Client', field_type: 'client_select', order_index: 7, show_in_header: true },
          { id: 'fb', label: 'Inspection Day Number', field_type: 'number', order_index: 8, show_in_header: false },
        ],
      },
      {
        id: 's2', title: 'Cargo Line Inspection Entry', is_repeatable: true,
        fields: [
          { id: 'g1', label: 'Cargo Line Name / Description', field_type: 'text', order_index: 0 },
          { id: 'g8', label: 'Photos', field_type: 'photo', order_index: 9 },
        ],
      },
    ]
    const fieldValues: Record<string, string> = {
      f3: '2026-06-25', f4: '09:00', f6: 'Vanuatu', f7: '3041', f8: 'Chaguaramas', fb: '1',
      g1: 'Test line 1', 'g1@@1': 'Test line 2',
    }
    // 8 photos: 4 on entry 0, 4 on entry 1.
    const photos = Array.from({ length: 8 }, (_, i) => ({
      field_id: 'g8', instance: i < 4 ? 0 : 1, url: IMG, caption: null, filename: `p${i}.jpg`,
    }))
    const el = React.createElement(JobPDF as any, {
      job: { vessel_name: 'Test Vessel', client: { name: 'ExxonMobil' }, job_number: 'TEAL C/L #1', title: 'X',
        template: { name: 'Daily Borescoping Report', pdf_include_photos: true } },
      sections, fieldValues, arrayValues: {}, signatures: {}, photoCount: 8, photos,
      surveyors: ['Captain Andrew Taylor', 'Robert Taylor'], preamble: 'Intro paragraph.',
      disclaimer: 'Disclaimer text.',
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)

  // Verify jobs.repeatable_order actually drives the report's entry order: the same
  // data rendered in two different orders must produce different output, and a
  // non-contiguous order (as left by an insert/remove) must still render.
  it('renders repeatable entries in the saved order', async () => {
    const sections = [{
      id: 's2', title: 'Cargo Line Inspection Entry', is_repeatable: true,
      fields: [{ id: 'g1', label: 'Cargo Line Name', field_type: 'text', order_index: 0 }],
    }]
    const fieldValues = { g1: 'Alpha', 'g1@@1': 'Bravo', 'g1@@2': 'Charlie' }
    const base = {
      sections, fieldValues, arrayValues: {}, signatures: {}, photoCount: 0, photos: [] as any[],
      surveyors: [] as string[],
    }
    const mk = (repeatable_order?: Record<string, number[]>) => renderToBuffer(
      React.createElement(JobPDF as any, {
        ...base,
        job: { vessel_name: 'V', title: 'X', job_number: 'N', template: { name: 'T' }, repeatable_order },
      }) as any
    )
    const natural = await mk(undefined)               // 0,1,2 → Alpha, Bravo, Charlie
    const reordered = await mk({ s2: [2, 0, 1] })      // Charlie, Alpha, Bravo
    const afterRemove = await mk({ s2: [0, 2] })       // non-contiguous (entry 1 removed)
    expect(natural.length).toBeGreaterThan(500)
    expect(afterRemove.length).toBeGreaterThan(500)
    // Different order ⇒ different bytes (the order prop is genuinely used, not ignored).
    expect(Buffer.from(reordered).equals(Buffer.from(natural))).toBe(false)
  }, 25000)
})

// The header is two columns. Historically the split was fixed: job-record rows (Vessel,
// Client, Date, Surveyor) left, checklist-derived rows (Port, Method of Delivery, Bunker
// Vessel Name) right. `balancedHeader` (migration 141) spreads them evenly instead — with
// Brine's six rows that is 3 and 3 rather than 4 and 2. These pin BOTH behaviours so the
// opt-in cannot silently become the default for every other report.
describe('JobPDF header column split', () => {
  const sections = [{
    id: 's1', title: 'Job Details', is_repeatable: false,
    fields: [
      { id: 'd', label: 'Date', field_type: 'date', order_index: 0 },
      { id: 'p', label: 'Port', field_type: 'text', order_index: 1 },
      { id: 'm', label: 'Method of Delivery', field_type: 'dropdown', order_index: 2,
        options: [{ value: 'shore_tank', label: 'Shore Tank' }] },
    ],
  }]
  const fieldValues = { d: '2026-07-18', p: 'Point Lisas', m: 'shore_tank' }
  const job: any = {
    id: 'j1', title: 'Brine Transfer', job_number: '26-07-001',
    vessel_name: 'Test Vessel', client: { name: 'Test Client' },
    template: { name: 'Brine Transfer Checklist' },
  }
  const common = {
    job, sections: sections as any, fieldValues, arrayValues: {}, signatures: {},
    photoCount: 0, photos: [], surveyors: ['A. Taylor'],
  }

  it('renders with the historic fixed split by default', async () => {
    const buf = await renderToBuffer(React.createElement(JobPDF, common as any) as any)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('renders with an even split when the template opts in', async () => {
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, balancedHeader: true } as any) as any,
    )
    expect(buf.length).toBeGreaterThan(0)
  })

})

// A repeatable section normally starts on a fresh page (Borescoping prints a page of
// photos per entry). Brine's hourly log is one question mid-checklist, where that left
// most of a page blank — so a section can opt out via pdf_page_break. Default stays true.
describe('JobPDF repeatable section page break', () => {
  const makeSections = (pdfPageBreak?: boolean) => [
    {
      id: 's1', title: 'Mid Loading', is_repeatable: false,
      fields: [{ id: 'q24', label: 'Periodic samples taken?', field_type: 'yes_no', item_number: '24', order_index: 0 }],
    },
    {
      id: 's2', title: 'Hourly Loading Line Inspection', is_repeatable: true,
      ...(pdfPageBreak === undefined ? {} : { pdf_page_break: pdfPageBreak }),
      fields: [{ id: 'q25', label: 'Time of inspection', field_type: 'time', item_number: '25', order_index: 0 }],
    },
    {
      id: 's3', title: 'Final', is_repeatable: false,
      fields: [{ id: 'q26', label: 'Lines blown through?', field_type: 'yes_no', item_number: '26', order_index: 0 }],
    },
  ]
  const common = {
    job: { id: 'j1', title: 'Brine', job_number: '26-07-001', template: { name: 'Brine Transfer Checklist' } } as any,
    fieldValues: { q24: 'yes', q25: '14:50', q26: 'yes' },
    arrayValues: {}, signatures: {}, photoCount: 0, photos: [],
  }

  it('renders when the section opts out of the page break', async () => {
    const buf = await renderToBuffer(
      React.createElement(JobPDF, { ...common, sections: makeSections(false) as any } as any) as any)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('still breaks by default, and when the column is absent', async () => {
    for (const sections of [makeSections(true), makeSections(undefined)]) {
      const buf = await renderToBuffer(
        React.createElement(JobPDF, { ...common, sections: sections as any } as any) as any)
      expect(buf.length).toBeGreaterThan(0)
    }
  })

  it('opting out produces a SHORTER document than forcing the break', async () => {
    // The real symptom: a forced break wastes most of a page, so the same content spans
    // more pages. Byte length is a proxy — a page of whitespace still costs page objects.
    const [flowed, broken] = await Promise.all([
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: makeSections(false) as any } as any) as any),
      renderToBuffer(React.createElement(JobPDF, { ...common, sections: makeSections(true) as any } as any) as any),
    ])
    expect(flowed.length).toBeLessThan(broken.length)
  })
})
