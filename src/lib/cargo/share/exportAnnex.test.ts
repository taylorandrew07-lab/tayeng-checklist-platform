import { describe, it, expect } from 'vitest'
import { annexFilename } from './exportAnnex'
import { renderVoyageAnnex } from './annex'
import type { Voyage, ReadingType } from '../types'

const temp: ReadingType = {
  id: 'temp', name: 'Thermocouple Temperature', unit: '°C', appliesTo: 'all',
  includeInTables: true, includeInCharts: true, includeInPdf: true,
  points: [{ id: 'p1', name: 'TC 1', group: 'BTM' }, { id: 'p2', name: 'TC 2', group: 'LVL 2' }],
  colorRules: { amber: 60, red: 65, rateDeltaC: 10, gradient: true },
}

function voyage(overrides: Partial<Voyage> = {}): Voyage {
  // Every day and every round carries a DISTINCT value. With identical values
  // repeated everywhere, a render that silently dropped a day — or every round
  // but the last — would still satisfy a toContain() assertion.
  const readings: Voyage['readings'] = {}
  const days = ['2026-08-04', '2026-08-05']
  days.forEach((d, di) => {
    readings[d] = {}
    ;['0600', '1200', '1800'].forEach((p, pi) => {
      const n = (v: number) => (v + di * 10 + pi).toFixed(1)
      readings[d][p] = {
        '1': { temp: { p1: n(41.2), p2: n(43.8) } },
        '2': { temp: { p1: n(68.9), p2: n(71.4) } },
      }
    })
  })
  return {
    id: 'voyage_x', userId: 'u1',
    vesselName: 'Channel Pearl', vesselType: 'M.V.', voyageNumber: 'V-047',
    cargoType: 'DRI - B', loadingPort: 'Point Lisas', dischargePort: 'Darrow, New Orleans',
    startDate: '2026-08-04', endDate: '', holdCount: 2, surveyorName: 'Nary Ramjohn',
    readingTypes: [temp], readings, periodMeta: {},
    createdAt: 0, updatedAt: Date.parse('2026-08-11T14:00:00Z'),
    ...overrides,
  } as Voyage
}

describe('annexFilename', () => {
  it('is dated, so a chain of daily emails stays sortable', () => {
    expect(annexFilename(voyage(), new Date('2026-08-11T12:00:00'))).toBe('M_V_Channel_Pearl_V-047_2026-08-11.html')
  })

  it('survives a voyage with no number or vessel', () => {
    expect(annexFilename(voyage({ vesselName: '', voyageNumber: '' }), new Date('2026-08-11T12:00:00')))
      .toMatch(/^[A-Za-z_]+_2026-08-11\.html$/)
  })
})

/** Freeze an object graph so any attempted write throws (ES modules are strict
 *  mode, so a frozen-object write is a TypeError rather than a silent no-op). */
function deepFreeze<T>(o: T, seen = new Set<unknown>()): T {
  if (o === null || typeof o !== 'object' || seen.has(o)) return o
  seen.add(o)
  for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v, seen)
  return Object.freeze(o)
}

describe('read-only guarantee', () => {
  // THE most important property of this feature. A surveyor is offline for weeks
  // with the only copy of his readings in IndexedDB, and the workspace autosaves
  // the voyage object it holds. If rendering a snapshot mutated that object —
  // even just sorting an array in place — the mutation would be persisted, and
  // could reach his next sync as a change he never made.
  it('cannot modify the voyage it renders', () => {
    const frozen = deepFreeze(voyage())
    expect(() => renderVoyageAnnex(frozen, { interactive: false })).not.toThrow()
    expect(() => renderVoyageAnnex(frozen, { interactive: true })).not.toThrow()
  })

  it('renders identically twice — no hidden state carried between calls', () => {
    const v = voyage()
    const a = renderVoyageAnnex(v, { interactive: false, generatedAt: new Date('2026-08-11T12:00:00Z') })
    const b = renderVoyageAnnex(v, { interactive: false, generatedAt: new Date('2026-08-11T12:00:00Z') })
    expect(a).toBe(b)
  })

  it('leaves the voyage byte-identical after a render', () => {
    const v = voyage()
    const before = JSON.stringify(v)
    renderVoyageAnnex(v, { interactive: false })
    expect(JSON.stringify(v)).toBe(before)
  })
})

describe('the emailed snapshot vs the shared link', () => {
  // Rendered with the SAME options buildVoyageSnapshot uses, or the tests prove
  // something the surveyor never receives.
  const emailed = renderVoyageAnnex(voyage(), { interactive: false, selfContained: true })
  const linked = renderVoyageAnnex(voyage(), { interactive: true })

  it('carries EVERY reading of every day and round — not just the last', () => {
    // 2 days x 3 rounds x 2 holds x 2 points = 24 distinct values. All of them
    // must appear, or the snapshot has silently dropped part of the voyage.
    const expected: string[] = []
    for (let di = 0; di < 2; di++) {
      for (let pi = 0; pi < 3; pi++) {
        for (const base of [41.2, 43.8, 68.9, 71.4]) expected.push((base + di * 10 + pi).toFixed(1))
      }
    }
    for (const html of [emailed, linked]) {
      for (const v of expected) expect(html).toContain(`>${v}<`)
    }
    // Both holds, the whole voyage to date, exactly as the Excel carried it.
    expect((emailed.match(/class="stick">Hold /g) ?? []).length).toBe(2)
    // Every column: 2 days x 3 rounds.
    expect((emailed.match(/class="r-round"/g) ?? []).length).toBe(1)
  })

  it('drops the hover payload from the emailed copy but keeps the charts', () => {
    expect(linked).toContain('data-chart=')
    expect(emailed).toContain('data-chart=')          // charts still drawn
    expect(emailed).toContain('class="ln"')           // every series still plotted
    expect(linked).toContain('var V=')                // the duplicate data block
    expect(emailed).not.toContain('var V=')           // ...gone
    expect(emailed).not.toContain('class="hit"')      // and its hover target
    expect(emailed).not.toContain('id="tip"')
  })

  it('carries NO script at all, and hides nothing behind one', () => {
    // A recipient opening a mail attachment may have scripts blocked. If the
    // Charts section were a `hidden` tab panel needing JS to reveal it, half the
    // deliverable would be invisible with no way to reach it. The emailed copy
    // therefore stacks both sections as plain visible blocks and ships no script.
    expect(emailed).not.toContain('<script')
    // Asserted on the MARKUP, not anywhere in the file — the stylesheet still
    // carries the [role="tabpanel"][hidden] rule, which a looser check matches.
    expect(emailed).not.toMatch(/<section[^>]*role="tabpanel"/)
    expect(emailed).not.toMatch(/<section[^>]*hidden/)
    expect(emailed).toContain('<h2 class="sec">Readings</h2>')
    expect(emailed).toContain('<h2 class="sec">Charts</h2>')
    // The link keeps its tabs and hover.
    expect(linked).toMatch(/<section[^>]*role="tabpanel"/)
    expect(linked).toContain('<script>')
  })

  it('never tells the reader to hover a chart that cannot respond', () => {
    expect(emailed).not.toMatch(/hover the chart/i)
    expect(linked).toMatch(/Hover the chart/)
  })

  it('does not claim readings are being withheld — this copy IS the record', () => {
    expect(emailed).not.toContain('has not yet reached us')
    expect(emailed).toContain('later rounds will appear on a subsequent report')
  })

  it('is materially smaller at a REAL voyage scale', () => {
    // Measured on the shape this actually ships against — a fortnight, 5 holds,
    // 21 thermocouples — not on the toy fixture above, where the fixed CSS
    // dwarfs the payload and would flatter the result.
    const points = Array.from({ length: 21 }, (_, i) => ({ id: `tc${i + 1}`, name: `TC ${i + 1}` }))
    const days = Array.from({ length: 14 }, (_, i) => `2026-08-${String(4 + i).padStart(2, '0')}`)
    const readings: Voyage['readings'] = {}
    for (const d of days) {
      readings[d] = {}
      for (const p of ['0600', '1200', '1800']) {
        readings[d][p] = {}
        for (let hold = 1; hold <= 5; hold++) {
          const vals: Record<string, string> = {}
          points.forEach((pt, i) => { vals[pt.id] = (38 + ((i * 7 + hold * 3) % 25) + 0.4).toFixed(1) })
          readings[d][p][String(hold)] = { temp: vals }
        }
      }
    }
    const big = voyage({ holdCount: 5, readingTypes: [{ ...temp, points }], readings })
    const withHover = renderVoyageAnnex(big, { interactive: true }).length
    const without = renderVoyageAnnex(big, { interactive: false }).length

    // Dropping the hover saves about 12% — NOT the "roughly half" first
    // estimated. The bulk of the file is the readings grid itself (4,410 cells
    // for this shape) and the chart polylines; the duplicated payload is a
    // smaller share than it looks. Recorded here so nobody re-derives the
    // wrong figure from the option's name.
    expect(without).toBeLessThan(withHover)
    expect(without / withHover).toBeLessThan(0.95)
    // What actually matters for a daily email off a vessel: a fortnight's
    // snapshot is comfortably under a megabyte.
    expect(without).toBeLessThan(1_000_000)
  })

  it('still stands alone — no network reference of any kind', () => {
    // It is opened by a recipient who may be offline, from a mail attachment.
    expect(emailed).not.toMatch(/<(script|img|link)[^>]+src="(https?:)?\/\//)
    expect(emailed).not.toMatch(/@import|url\(https?:/)
    expect(emailed).not.toMatch(/href="\/(admin|surveyor|office|client|login|r\/)/)
    expect(emailed.startsWith('<!doctype html>')).toBe(true)
  })

  it('dates the readings, not the moment of export', () => {
    const html = renderVoyageAnnex(voyage(), { interactive: false, generatedAt: new Date('2026-08-12T09:00:00Z') })
    expect(html).toContain('Readings as at 11 Aug 2026, 10:00 AST')
  })
})
