import { describe, it, expect } from 'vitest'
import { renderVoyageAnnex } from './annex'
import type { Voyage, ReadingType } from '../types'

function tempType(overrides: Partial<ReadingType> = {}): ReadingType {
  return {
    id: 'temp', name: 'DRI temperature', unit: '°C', appliesTo: 'all',
    includeInTables: true, includeInCharts: true, includeInPdf: true,
    points: [
      { id: 'p1', name: 'TC 1', group: 'BTM' },
      { id: 'p2', name: 'TC 2', group: 'LVL 2' },
    ],
    colorRules: { amber: 60, red: 65, rateDeltaC: 10, gradient: true },
    ...overrides,
  }
}

function voyage(overrides: Partial<Voyage> = {}): Voyage {
  const readings: Voyage['readings'] = {}
  for (const d of ['2026-06-01', '2026-06-02']) {
    readings[d] = {}
    for (const p of ['0600', '1200', '1800']) {
      readings[d][p] = {
        // Hold 1 normal, Hold 2 well over the red band.
        '1': { temp: { p1: '41.2', p2: '43.8' }, o2: { main: '19.4' } },
        '2': { temp: { p1: '68.9', p2: '71.4' }, o2: { main: '12.1' } },
      }
    }
  }
  return {
    id: 'v1', userId: 'u1',
    vesselName: 'Cape Trinity', vesselType: 'M.V.', voyageNumber: '26/04',
    cargoType: 'DRI', loadingPort: 'Point Lisas', dischargePort: 'Rotterdam',
    startDate: '2026-06-01', endDate: '2026-06-02', holdCount: 2,
    surveyorName: 'A. Taylor', clientName: 'Northgate Commodities',
    readingTypes: [
      tempType(),
      { id: 'o2', name: 'Oxygen', unit: '%', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, points: [{ id: 'main', name: 'Oxygen' }] },
    ],
    readings, periodMeta: {}, createdAt: 0, updatedAt: 0,
    ...overrides,
  } as Voyage
}

describe('renderVoyageAnnex', () => {
  it('renders a complete standalone document with the readings in it', () => {
    const html = renderVoyageAnnex(voyage())
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<h1>Cargo Monitoring &mdash; Data Annex</h1>')
    // The vessel appears in the browser title and once as a labelled field —
    // never as a subtitle repeating what the field block already says.
    expect(html).toContain('<title>M.V. Cape Trinity — Cargo Monitoring Data Annex</title>')
    expect(html).not.toContain('class="sub"')
    expect((html.match(/M\.V\. Cape Trinity/g) ?? []).length).toBe(2)
    expect(html).toContain('41.2')
    expect(html).toContain('68.9')
    // Two holds, each getting a band.
    expect((html.match(/class="stick">Hold /g) ?? []).length).toBe(2)
    // No link back into the app from a public document.
    expect(html).not.toMatch(/href="\/(admin|surveyor|office|client|login)/)
  })

  it('colours cells by the type thresholds, and drops ALL colour when showColors is off', () => {
    const on = renderVoyageAnnex(voyage())
    expect(on).toContain('class="crit"')   // 68.9 / 71.4 are over the 65 red band
    expect(on).toContain('class="ok"')

    const off = renderVoyageAnnex(voyage({ showColors: false }))
    expect(off).not.toContain('class="crit"')
    expect(off).not.toContain('class="warn"')
    expect(off).not.toContain('class="ok"')
    expect(off).not.toContain('class="grad"')
    // ...and the chart threshold lines go with them, or the chart would
    // contradict the unshaded grid beside it.
    expect(off).not.toContain('class="thr thr-')
    // ...and it says nothing about WHY. The recipient has no need to know a
    // setting was turned off, and naming it only invites the question.
    expect(off).not.toMatch(/colour coding/i)
  })

  it('honours includeInTables and appliesTo', () => {
    const hidden = renderVoyageAnnex(voyage({
      readingTypes: [tempType(), { id: 'rh', name: 'Headspace humidity', unit: '%RH', appliesTo: 'all', includeInTables: false, includeInCharts: false, includeInPdf: false, points: [{ id: 'main', name: 'Headspace humidity' }] }],
    }))
    expect(hidden).not.toContain('<b>Headspace humidity</b>')
    // Excluded types are named rather than silently dropped.
    expect(hidden).toContain('Also recorded on this voyage but not included here')

    const scoped = renderVoyageAnnex(voyage({ readingTypes: [tempType({ appliesTo: [2] })] }))
    // Exactly one GRID row for TC 1 — Hold 2's. Hold 1 still gets its band but
    // none of this type's rows. (Matched on the row header specifically: the
    // point also appears as a chart series label.)
    expect((scoped.match(/<b>TC 1<\/b>/g) ?? []).length).toBe(1)
    expect((scoped.match(/class="stick">Hold /g) ?? []).length).toBe(2)
  })

  it('escapes surveyor-authored text — it lands on a public page', () => {
    const html = renderVoyageAnnex(voyage({
      vesselName: '<script>alert(1)</script>',
      observations: '<img src=x onerror="alert(2)">',
      readingTypes: [tempType({ points: [{ id: 'p1', name: '</td><script>alert(3)</script>', group: 'BTM' }] })],
    }))
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(3)</script>')
    expect(html).toContain('&lt;script&gt;')
    // Exactly one real script tag: the tooltip/tab behaviour.
    expect((html.match(/<script>/g) ?? []).length).toBe(1)
  })

  it('lays the header out as a filled 5-column grid, commenced starting row 2', () => {
    const labels = [...renderVoyageAnnex(voyage()).matchAll(/<dt>([^<]+)<\/dt>/g)].map(m => m[1])
    expect(labels).toEqual([
      'Vessel', 'Voyage number', 'Cargo', 'Loading port', 'Discharge port',
      'Monitoring commenced', 'Monitoring completed', 'Holds monitored', 'Surveyor', 'Client',
    ])
    // Exactly two full rows of five — no stretched cell needed, no hole left.
    expect(labels).toHaveLength(10)
    expect(renderVoyageAnnex(voyage())).not.toMatch(/class="f[2-5]"/)
  })

  it('closes a short last row rather than leaving a gap beside it', () => {
    // No client → 9 fields → the last cell spans the remaining two columns.
    const html = renderVoyageAnnex(voyage({ clientName: undefined }))
    expect([...html.matchAll(/<dt>/g)]).toHaveLength(9)
    expect(html).toContain('class="f2"')
  })

  it('keeps a label and its unit on one line', () => {
    const html = renderVoyageAnnex(voyage())
    // Both live inside one flex row, so a long name can never push the unit onto
    // a second line and double the row height.
    expect(html).toContain('<span class="sw"><b>DRI temperature</b><em>°C</em></span>')
    expect(html).not.toMatch(/th\.s em\{float/)
  })

  it('bands alternate days, and never tints a cell that carries a threshold colour', () => {
    // Two monitoring days x three rounds: day 1 plain, day 2 banded.
    const html = renderVoyageAnnex(voyage())
    expect(html).toContain('class="plain alt"')      // day 2, no threshold colour
    expect(html).toContain(' ds"')                   // day 2 opens with the rule

    // The banding must never land on a threshold-coloured cell — an amber or red
    // reading has to look identical whichever day it fell on.
    for (const t of ['ok', 'warn', 'crit', 'grad']) {
      expect(html).not.toContain(`class="${t} alt"`)
      expect(html).not.toContain(`class="${t} alt ds"`)
    }
    // The rule itself DOES cross coloured cells — that's what carries the day
    // boundary through a fully-shaded temperature block.
    expect(html).toMatch(/class="(ok|warn|crit|grad) ds"/)
  })

  it('marks an unfinalised voyage preliminary and a finalised one final', () => {
    expect(renderVoyageAnnex(voyage())).toContain('Preliminary')
    expect(renderVoyageAnnex(voyage({ status: 'finalized' }))).toContain('finalised')
  })

  it('survives a voyage with no readings at all', () => {
    const html = renderVoyageAnnex(voyage({ readings: {}, readingTypes: [] }))
    expect(html).toContain('No readings have been recorded')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })
})
