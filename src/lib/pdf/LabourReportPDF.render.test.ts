// Renders the Labour & Overtime sheet for real, both variants, and reads the text back
// out of the produced PDF.
//
// A render test that only checks the buffer is non-empty proves the renderer did not
// throw and nothing else — and the two things this document must never do are both
// invisible to that check: print a pay figure on the sheet that gets circulated, and
// print a character the office cannot read. So this file inflates the content streams and
// decodes the text-showing operators, then asserts on the words that actually land on the
// page. Helvetica is one of the PDF standard 14 fonts, so @react-pdf embeds no subset and
// the glyph codes are plain WinAnsi bytes — which is exactly why the decoding works, and
// also why a character outside WinAnsi is a real risk here (see the last describe).
//
// `.ts` not `.tsx`, via React.createElement, matching SurveyorStatementPDF.render.test.ts.
// Every `it` carries an explicit 25s timeout: a cold @react-pdf render blows the 5s default.

import { describe, it, expect } from 'vitest'
import React from 'react'
import zlib from 'node:zlib'
import { renderToBuffer } from '@react-pdf/renderer'
import { LabourReportPDF, type LabourReportPdfProps, type LabourReportPdfRow } from './LabourReportPDF'

// ── Reading the text back out of a rendered PDF ──────────────────────────────

/** Inflate every FlateDecode stream in the file. */
function inflateStreams(buf: Buffer): string[] {
  const raw = buf.toString('latin1')
  const out: string[] = []
  const re = /stream[\r\n]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) continue
    let body = raw.slice(start, end)
    while (body.endsWith('\n') || body.endsWith('\r')) body = body.slice(0, -1)
    try {
      // Z_SYNC_FLUSH so a stream whose trailing bytes we trimmed imperfectly still
      // yields its content rather than throwing the whole assertion away.
      out.push(zlib.inflateSync(Buffer.from(body, 'latin1'), { finishFlush: zlib.constants.Z_SYNC_FLUSH }).toString('latin1'))
    } catch { /* not a deflate stream — an image, a font, or metadata */ }
  }
  return out
}

/** WinAnsiEncoding is NOT Latin-1: 0x80–0x9F carry punctuation where Latin-1 has control
 *  codes. Decoding those bytes as Latin-1 would turn a correctly-printed em dash into an
 *  invisible control character and make a passing document look broken — and, worse, hide
 *  a genuinely wrong glyph inside the same blank. Only this range differs. */
const WINANSI_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡', 0x88: 'ˆ',
  0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘', 0x92: '’', 0x93: '“',
  0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›',
  0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
}
const winansi = (byte: number): string => WINANSI_HIGH[byte] ?? String.fromCharCode(byte)

/** Decode a content stream's text-showing operands, in document order.
 *
 *  @react-pdf lays text out itself and emits a separate BT…ET run per positioned chunk,
 *  so one visible phrase ("15 h · 1 d") arrives as several runs. They are therefore
 *  concatenated rather than newline-joined: a phrase must be searchable as it reads on
 *  the page, and for the "no pay anywhere" assertions a flat join is also the strictest
 *  reading — it can only ever find more, never less. */
function decodeShownText(c: string): string {
  let out = ''
  let i = 0
  while (i < c.length) {
    const ch = c[i]
    if (ch === '(') {
      i++
      while (i < c.length && c[i] !== ')') {
        if (c[i] === '\\') { out += c[i + 1]; i += 2 } else { out += winansi(c.charCodeAt(i)); i++ }
      }
      i++
    } else if (ch === '<') {
      const k = c.indexOf('>', i)
      if (k < 0) { i++; continue }
      const hex = c.slice(i + 1, k)
      if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
        for (let h = 0; h + 1 < hex.length; h += 2) out += winansi(parseInt(hex.slice(h, h + 2), 16))
      }
      i = k + 1
    } else i++
  }
  return out
}

/** Every visible character in the document, in reading order. */
const pdfText = (buf: Buffer): string => inflateStreams(buf).map(decodeShownText).join('\n')

const pageCount = (buf: Buffer): number => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length

const render = (props: LabourReportPdfProps): Promise<Buffer> =>
  renderToBuffer(React.createElement(LabourReportPDF as any, props as any) as any) as Promise<Buffer>

// ── Fixtures ─────────────────────────────────────────────────────────────────

const row = (o: Partial<LabourReportPdfRow> = {}): LabourReportPdfRow => ({
  date: '12 Aug 2026',
  vessel: 'M.V. Scout',
  job: '26-08-263',
  client: 'BP Trinidad & Tobago',
  span: '08:00 – 17:00',
  spanEnd: '',
  reg: '11h',
  ot: '—',
  km: '—',
  flag: '',
  ...o,
})

// One month, mixed units, an overnight shift and a typed line with no log behind it.
const MIXED: LabourReportPdfRow[] = [
  row({ date: '12 Aug 2026', reg: '11h' }),
  row({ date: '20 Aug 2026', span: '19:00 – 03:30', spanEnd: 'ends 21 Aug', reg: '—', ot: '8.5h' }),
  row({ date: '24 Aug 2026', vessel: 'M.V. Pioneer', span: '—', reg: '1d', ot: '—', flag: 'typed day count' }),
  row({ date: '26 Aug 2026', vessel: 'M.V. Pioneer', span: '—', reg: '4h', ot: '—', flag: 'no shift log' }),
  row({ date: '02 Sep 2026', span: 'travel', reg: '—', ot: '—', km: '45 km' }),
]

const props = (o: Partial<LabourReportPdfProps> = {}): LabourReportPdfProps => ({
  periodLabel: 'August 2026',
  generatedLabel: '09 Sep 2026',
  withPay: false,
  surveyors: [{
    name: 'Andrew Taylor',
    rows: MIXED,
    totalReg: '15 h · 1 d',
    totalOt: '8.5 h',
    totalKm: '45 km',
    shifts: '4',
    payLabel: '',
  }],
  totalReg: '15 h · 1 d',
  totalOt: '8.5 h',
  totalKm: '45 km',
  surveyorCount: '1',
  companyPayLabel: '',
  warnings: [],
  ...o,
})

// ── The two variants ─────────────────────────────────────────────────────────

describe('the quantities-only variant', () => {
  it('renders a mixed-unit month without collapsing the units', async () => {
    const buf = await render(props())
    expect(buf.length).toBeGreaterThan(1000)
    const t = pdfText(buf)
    // Hours and days printed side by side, never as one number.
    expect(t).toContain('15 h · 1 d')
    expect(t).not.toContain('16 h')
    expect(t).toContain('LABOUR & OVERTIME')
    expect(t).toContain('Andrew Taylor')
    expect(t).toContain('M.V. Scout')
    expect(t).toContain('8.5h')
    expect(t).toContain('1d')
    expect(t).toContain('45 km')
  }, 25000)

  it('prints the flag that says a quantity had no shift behind it', async () => {
    const t = pdfText(await render(props()))
    expect(t).toContain('no shift log')
    // A day-billed job's payable quantity is ALWAYS typed, so it is not flagged as a
    // missing shift log — the shifts on those jobs are logged, and print separately.
    expect(t).toContain('typed day count')
  }, 25000)

  it('prints the end date of a shift that rolled past midnight', async () => {
    const t = pdfText(await render(props()))
    expect(t).toContain('20 Aug 2026')
    expect(t).toContain('ends 21 Aug')
  }, 25000)

  it('carries NO currency figure anywhere in the file — this sheet gets circulated', async () => {
    // Built from the same rows as the pay run below, and handed a payLabel the renderer
    // must refuse to print because withPay is false. If a later edit drops that guard,
    // this is the test that catches it before the sheet leaves the building.
    const buf = await render(props({
      withPay: false,
      companyPayLabel: 'USD 4,950.00',
      surveyors: [{ ...props().surveyors[0], payLabel: 'USD 495.00' }],
    }))
    const t = pdfText(buf)
    expect(t).not.toMatch(/USD|TTD|EUR|GBP|\$/)
    expect(t).not.toContain('495')
    expect(t).not.toContain('4,950')
    expect(t).not.toContain('PAY')
    expect(t).not.toContain('ADMIN ONLY')
    // And nowhere in the raw file either — not in the title, subject or any metadata.
    const raw = buf.toString('latin1')
    expect(raw).not.toContain('USD')
    expect(raw).not.toContain('PAY RUN')
  }, 25000)

  it('still prints the confidentiality footer and a page number on every page', async () => {
    // Not a formality: a page-level lineHeight collapses the auto height of a fixed or
    // absolute box, so its contents vanish and a `render` callback emits nothing at all —
    // which is why the sibling statement renderer's footer does not print today.
    const t = pdfText(await render(props()))
    expect(t).toContain('Private and Confidential')
    expect(t).toContain('Page 1 of 1')
  }, 25000)
})

describe('the pay-run variant', () => {
  it('renders the same grid from the same rows, with the money added', async () => {
    const withPay = props({
      withPay: true,
      companyPayLabel: 'USD 4,950.00',
      surveyors: [{ ...props().surveyors[0], payLabel: 'USD 495.00' }],
    })
    const buf = await render(withPay)
    expect(buf.length).toBeGreaterThan(1000)
    const t = pdfText(buf)
    expect(t).toContain('PAY RUN')
    expect(t).toContain('USD 495.00')
    expect(t).toContain('USD 4,950.00')
    // Same column grid as the circulate-safe sheet, so the two can be laid side by side.
    expect(t).toContain('M.V. Scout')
    expect(t).toContain('15 h · 1 d')
    expect(t).toContain('8.5h')
  }, 25000)

  it('says on every page that it is the admin-only sheet', async () => {
    const t = pdfText(await render(props({
      withPay: true,
      companyPayLabel: 'USD 4,950.00',
      surveyors: [{ ...props().surveyors[0], payLabel: 'USD 495.00' }],
    })))
    expect(t).toContain('ADMIN ONLY')
  }, 25000)

  it('prints several currencies side by side and never their sum', async () => {
    const t = pdfText(await render(props({
      withPay: true,
      companyPayLabel: 'USD 495.00 · TTD 1,200.00',
      surveyors: [{ ...props().surveyors[0], payLabel: 'USD 495.00 · TTD 1,200.00' }],
    })))
    expect(t).toContain('USD 495.00 · TTD 1,200.00')
    expect(t).not.toContain('1,695')
  }, 25000)
})

// ── Pagination ───────────────────────────────────────────────────────────────

describe('a whole month of surveyors', () => {
  it('starts each surveyor on a page of their own, so a page IS one person’s sheet', async () => {
    const surveyors = Array.from({ length: 12 }, (_, i) => ({
      name: `Surveyor ${i + 1}`,
      rows: Array.from({ length: 14 }, (_, j) => row({ date: `${String(j + 1).padStart(2, '0')} Aug 2026` })),
      totalReg: '154 h',
      totalOt: '—',
      totalKm: '—',
      shifts: '14',
      payLabel: '',
    }))
    const buf = await render(props({ surveyors, surveyorCount: '12', totalReg: '1,848 h' }))
    expect(pageCount(buf)).toBeGreaterThanOrEqual(12)
    const t = pdfText(buf)
    expect(t).toContain('Surveyor 1')
    expect(t).toContain('Surveyor 12')
    expect(t).toContain('Page 12 of')
  }, 25000)

  it('renders an empty month without throwing', async () => {
    const buf = await render(props({ surveyors: [], surveyorCount: '0', totalReg: '—', totalOt: '—', totalKm: '—' }))
    expect(buf.length).toBeGreaterThan(1000)
  }, 25000)
})

// ── The reconciliation banner ────────────────────────────────────────────────

describe('a sheet that disagrees with the Finance Overview panel', () => {
  it('says so on the document, in words the office can act on', async () => {
    const t = pdfText(await render(props({
      warnings: ['Andrew Taylor — regular hours: this report 8, the Finance Overview panel 8.5'],
    })))
    expect(t).toContain('DOES NOT RECONCILE')
    expect(t).toContain('Andrew Taylor')
    expect(t).toContain('regular hours')
    expect(t).toContain('8.5')
  }, 25000)
})

// ── Characters the standard fonts can actually print ─────────────────────────

describe('every character on the page is one Helvetica can print', () => {
  // Helvetica is a PDF standard-14 font with WinAnsiEncoding: 256 codepoints, no arrows.
  // A character outside it is not dropped and does not throw — it is written out as its
  // low byte, so it silently becomes a DIFFERENT, wrong glyph on the printed sheet.
  // An arrow (U+2192) is the specific character that got this wrong: it is not in
  // WinAnsi, and @react-pdf neither throws nor drops it — it writes the low byte, so
  // '08:00 → 17:00' printed as "08:00 ’ 17:00" on the delivered sheet. The en dash IS in
  // WinAnsi, so the span reads back exactly as it was written.
  it('prints the shift-span separator, and not the apostrophe an arrow would become', async () => {
    const t = pdfText(await render(props({
      surveyors: [{ ...props().surveyors[0], rows: [row({ span: '19:00 – 03:30', spanEnd: 'ends 21 Aug' })] }],
    })))
    expect(t).toContain('19:00 – 03:30')
    expect(t).not.toContain('19:00 ’ 03:30')
  }, 25000)

  it('prints the reconciliation banner heading intact', async () => {
    const t = pdfText(await render(props({ warnings: ['Andrew Taylor — regular hours'] })))
    expect(t).toContain('DOES NOT RECONCILE WITH THE FINANCE OVERVIEW PANEL')
  }, 25000)

  it('prints the separators that DO exist in WinAnsi — the middot and the em dash', async () => {
    const t = pdfText(await render(props()))
    expect(t).toContain('15 h · 1 d')
    expect(t).toContain('typed day count')
    expect(t).toContain('—')
  }, 25000)

  // The whole page, not just the strings this file happens to assert on: anything
  // outside WinAnsi would have been written as a wrong glyph rather than refused.
  it('puts no character on the page that Helvetica cannot encode', async () => {
    const t = pdfText(await render(props({
      warnings: ['Andrew Taylor — regular hours: this report 8, the Finance Overview panel 8.5'],
    })))
    const OUTSIDE = /[\u2190-\u21ff\u2200-\u22ff\u2600-\u27bf]/
    expect(OUTSIDE.test(t)).toBe(false)
  }, 25000)
})
