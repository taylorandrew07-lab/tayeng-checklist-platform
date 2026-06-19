import { describe, it, expect } from 'vitest'
import { buildReportBlocks } from './dri-report'
import { emptyDriReport, type SectionKey } from './dri'
import type { Voyage } from './types'

// Minimal voyage factory — only the fields buildReportBlocks reads.
function voyage(overrides: Partial<Voyage> = {}): Voyage {
  return {
    holdCount: 3,
    vesselName: 'Test Vessel',
    voyageNumber: '7',
    cargoType: 'DRI',
    loadingPort: 'Point Lisas',
    dischargePort: 'New Orleans',
    startDate: '2026-01-01',
    endDate: '2026-01-10',
    surveyorName: 'A. Surveyor',
    readingTypes: [],
    readings: {},
    dri: emptyDriReport(3),
    ...overrides,
  } as unknown as Voyage
}

const textOf = (blocks: ReturnType<typeof buildReportBlocks>) =>
  blocks.map(b => ('text' in b ? b.text : b.headers.join('|'))).join('\n')

describe('buildReportBlocks — report fidelity', () => {
  it('prints both ports in the header', () => {
    const out = textOf(buildReportBlocks(voyage(), ['header']))
    expect(out).toContain('LOAD PORT: Point Lisas')
    expect(out).toContain('DISCHARGE PORT: New Orleans')
  })

  it('prints the preliminary-meeting heading even with no data (legacy heading-only)', () => {
    const out = buildReportBlocks(voyage(), ['preliminary_meeting'])
    expect(out.some(b => b.kind === 'h2' && b.text === 'PRELIMINARY MEETING')).toBe(true)
  })

  it('honours a configurable legacy heading override', () => {
    const dri = emptyDriReport(3)
    dri.tcWireLengths = [{ id: '1', wiringLevel: 'Base', appliesToHolds: 'all', tcNumber: 1, lengthValue: 10, lengthUnit: 'm' }]
    dri.reportConfig = { name: 'legacy', includedSections: [], options: { labels: { tc_wire_lengths: 'THERMOCOUPLE WIRE LENGHTS' } }, createdAt: 0 }
    const out = buildReportBlocks(voyage({ dri }), ['tc_wire_lengths'])
    expect(out.some(b => b.kind === 'h2' && b.text === 'THERMOCOUPLE WIRE LENGHTS')).toBe(true)
  })

  it('sorts IR readings chronologically regardless of entry order', () => {
    const dri = emptyDriReport(3)
    dri.irReadings = [
      { id: 'b', phase: 'LOAD', readingDate: '2026-01-02', readingTime: '0600', holdNo: 1, fwdC: 30, midC: 30, aftC: 30 },
      { id: 'a', phase: 'LOAD', readingDate: '2026-01-01', readingTime: '1800', holdNo: 1, fwdC: 31, midC: 31, aftC: 31 },
    ]
    const out = buildReportBlocks(voyage({ dri }), ['ir_load'])
    const table = out.find(b => b.kind === 'table')!
    // first data row should be the earlier date (01 Jan), not the entry-order first (02 Jan)
    expect((table as any).rows[0][0]).toContain('1 January')
  })

  it('emits one barge list per location', () => {
    const dri = emptyDriReport(3)
    dri.barges = [
      { id: '1', location: 'Berth A', bargeId: 'BG-1', holds: '1', commenceAt: '', completedAt: '' },
      { id: '2', location: 'Berth B', bargeId: 'BG-2', holds: '2', commenceAt: '', completedAt: '' },
    ]
    const out = buildReportBlocks(voyage({ dri }), ['barge_list'])
    const headings = out.filter(b => b.kind === 'h2').map(b => (b as any).text)
    expect(headings).toContain('BARGE LIST BERTH A')
    expect(headings).toContain('BARGE LIST BERTH B')
  })
})
