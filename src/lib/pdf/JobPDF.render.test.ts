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
})
