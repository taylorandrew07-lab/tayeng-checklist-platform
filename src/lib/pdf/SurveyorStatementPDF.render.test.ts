import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { SurveyorStatementPDF } from './SurveyorStatementPDF'

// Renders a statement with a mix of hours- and days-billed rows + a totals band, to
// guard that the table, the day/hours split totals, and the footer all render without
// throwing.
describe('SurveyorStatementPDF render', () => {
  it('renders a mixed-unit work statement', async () => {
    const el = React.createElement(SurveyorStatementPDF as any, {
      surveyorName: 'Andrew Taylor',
      periodLabel: 'June 2026',
      generatedLabel: '23 Jul 2026',
      rows: [
        { date: '2026-06-12', vessel: 'M.V. Scout', client: 'ExxonMobil', reg: '8h', ot: '2h', km: '40' },
        { date: '2026-06-28', vessel: 'M.V. Pioneer', client: 'BP', reg: '2d', ot: '—', km: '—' },
      ],
      totalReg: '8 h · 2 d',
      totalOt: '2 h',
      totalKm: '40 km',
    })
    const buf = await renderToBuffer(el as any)
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)
})
