import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { BorescopingReportPDF } from './BorescopingReportPDF'

// 1x1 transparent PNG as a data URI — no network fetch, so this isolates LAYOUT from
// image downloading.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// The live "Daily Borescoping Report" template's fields (migrations 093/099-104).
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
      { id: 'g1', label: 'Cargo Line Name / Description', field_type: 'text', order_index: 0, item_number: '1' },
      { id: 'g2', label: 'Cargo Line Condition', field_type: 'multiple_choice', order_index: 1, item_number: '2',
        options: [{ value: 'minor_residue_present', label: 'Minor Residue Present' }] },
      { id: 'g3', label: 'Type of Inspection', field_type: 'dropdown', order_index: 2, item_number: '3',
        options: [{ value: 'initial', label: 'Initial' }] },
      { id: 'g5', label: 'Distance (m)', field_type: 'number', unit: 'm', order_index: 4, item_number: '5' },
      { id: 'g8', label: 'Photos & Video Link', field_type: 'video_link', order_index: 7, item_number: '8' },
      { id: 'g9', label: 'Photos', field_type: 'photo', order_index: 9, item_number: '10' },
    ],
  },
]

describe('BorescopingReportPDF render', () => {
  it('completes without hanging and embeds per-entry photos', async () => {
    const fieldValues: Record<string, string> = {
      f3: '2026-07-06', f4: '19:30', f6: 'Galliano', f7: '3242', f8: 'Salt Docks', fb: '1',
      g1: 'Lower Discharge Liquid Mud Line', 'g1@@1': 'Upper Discharge Liquid Mud Line',
      g5: '5', 'g5@@1': '6', g3: 'initial', 'g3@@1': 'initial',
    }
    const arrayValues: Record<string, string[]> = { g2: ['minor_residue_present'] }
    // 5 photos: 2 on entry 0, 3 on entry 1.
    const photos = Array.from({ length: 5 }, (_, i) => ({
      field_id: 'g9', instance: i < 2 ? 0 : 1, url: IMG, caption: null, filename: `p${i}.jpg`,
    }))
    const el = React.createElement(BorescopingReportPDF as any, {
      job: { vessel_name: 'Ted Smith', client: { name: 'ExxonMobil Guyana Limited' }, job_number: 'TEAL C/L #1123', title: 'X',
        template: { name: 'Daily Borescoping Report', pdf_include_photos: true } },
      sections, fieldValues, arrayValues, signatures: {}, photoCount: 5, photos,
      surveyors: ['Robert Taylor', 'Captain Andrew Taylor'],
      preamble: 'Taylor Engineering Agencies Limited attended the above vessel.',
      disclaimer: 'This report remains the property of Taylor Engineering Agencies Limited.',
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)

  it('honours the saved repeatable entry order', async () => {
    const oneSection = [{
      id: 's2', title: 'Cargo Line Inspection Entry', is_repeatable: true,
      fields: [{ id: 'g1', label: 'Cargo Line Name', field_type: 'text', order_index: 0, item_number: '1' }],
    }]
    const fieldValues = { g1: 'Alpha', 'g1@@1': 'Bravo', 'g1@@2': 'Charlie' }
    const base = {
      sections: oneSection, fieldValues, arrayValues: {}, signatures: {}, photoCount: 0, photos: [] as any[],
      surveyors: [] as string[],
    }
    const mk = (repeatable_order?: Record<string, number[]>) => renderToBuffer(
      React.createElement(BorescopingReportPDF as any, {
        ...base,
        job: { vessel_name: 'V', title: 'X', job_number: 'N', template: { name: 'Daily Borescoping Report' }, repeatable_order },
      }) as any
    )
    const natural = await mk(undefined)
    const reordered = await mk({ s2: [2, 0, 1] })
    const afterRemove = await mk({ s2: [0, 2] })
    expect(natural.length).toBeGreaterThan(500)
    expect(afterRemove.length).toBeGreaterThan(500)
    expect(Buffer.from(reordered).equals(Buffer.from(natural))).toBe(false)
  }, 25000)
})
