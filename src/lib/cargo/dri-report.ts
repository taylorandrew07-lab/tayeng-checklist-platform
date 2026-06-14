// DRI report assembler. Turns a voyage + its dri sections + a list of ticked
// section keys into an ordered list of plain "blocks" (headings / paragraphs /
// tables) in the CANONICAL order. Both the PDF and the .docx renderers consume
// these blocks, so the section logic lives in exactly one place.
//
// The Temperature & Gas section READS the existing sensor readings
// (Voyage.readings) — it does not duplicate them.

import type { Voyage, ReadingType } from './types'
import { ensureDri, DEFAULT_SURVEYOR_TITLE, type SectionKey, type SofEvent } from './dri'

export type Block =
  | { kind: 'h1'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'p'; text: string; bold?: boolean }
  | { kind: 'table'; headers: string[]; rows: string[][] }

// ── formatting ───────────────────────────────────────────────────────────────
const fmtDate = (iso?: string | null): string => {
  if (!iso) return ''
  try { return new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) } catch { return iso }
}
const hhmmOf = (s?: string | null): string => {
  if (!s) return ''
  if (/^\d{4}$/.test(s)) return s
  const t = s.includes('T') ? s.slice(11, 16) : s
  return t.replace(':', '')
}
const fmtDT = (s?: string | null): string => {
  if (!s) return ''
  const d = fmtDate(s.slice(0, 10)); const t = hhmmOf(s)
  return [d, t].filter(Boolean).join(' ')
}
const numStr = (n?: number | null): string => (n == null || Number.isNaN(n) ? '—' : String(n))

function sofBlocks(events: SofEvent[], out: Block[]) {
  const byDate = new Map<string, SofEvent[]>()
  for (const e of events) { const g = byDate.get(e.eventDate) ?? []; g.push(e); byDate.set(e.eventDate, g) }
  for (const d of [...byDate.keys()].sort()) {
    const rows = byDate.get(d)!.sort((a, b) => a.eventTime.localeCompare(b.eventTime) || a.sortOrder - b.sortOrder)
    out.push({ kind: 'p', text: fmtDate(d), bold: true })
    out.push({ kind: 'table', headers: ['TIME', 'EVENT'], rows: rows.map(e => [e.eventTime, e.eventText]) })
  }
}

/** Per reading-type, per hold min/max/avg across all dates/periods/points. */
export function summarizeReadings(voyage: Voyage): string[][] {
  const typeById = new Map<string, ReadingType>(voyage.readingTypes.map(rt => [rt.id, rt]))
  // acc[rtId][hold] = { min, max, sum, n }
  const acc = new Map<string, Map<number, { min: number; max: number; sum: number; n: number }>>()
  for (const byPeriod of Object.values(voyage.readings ?? {})) {
    for (const byHold of Object.values(byPeriod ?? {})) {
      for (const [holdStr, byType] of Object.entries(byHold ?? {})) {
        const hold = Number(holdStr)
        for (const [rtId, byPoint] of Object.entries(byType ?? {})) {
          for (const v of Object.values(byPoint ?? {})) {
            const n = Number(v)
            if (v === '' || Number.isNaN(n)) continue
            let holds = acc.get(rtId); if (!holds) { holds = new Map(); acc.set(rtId, holds) }
            const cur = holds.get(hold) ?? { min: n, max: n, sum: 0, n: 0 }
            cur.min = Math.min(cur.min, n); cur.max = Math.max(cur.max, n); cur.sum += n; cur.n += 1
            holds.set(hold, cur)
          }
        }
      }
    }
  }
  const rows: string[][] = []
  for (const rt of voyage.readingTypes) {
    const holds = acc.get(rt.id); if (!holds) continue
    for (const hold of [...holds.keys()].sort((a, b) => a - b)) {
      const s = holds.get(hold)!
      rows.push([typeById.get(rt.id)?.name ?? rt.id, String(hold), s.min.toFixed(1), s.max.toFixed(1), (s.sum / s.n).toFixed(1), rt.unit])
    }
  }
  return rows
}

/** Assemble the report into ordered blocks for the ticked sections.
 *  `opts.reportNumber` prints the official report number (issued from the shared
 *  job-number series) under the header. */
export function buildReportBlocks(voyage: Voyage, included: SectionKey[], opts?: { reportNumber?: string }): Block[] {
  const dri = ensureDri(voyage.dri, voyage.holdCount)
  const has = (k: SectionKey) => included.includes(k)
  const out: Block[] = []

  if (has('header')) {
    out.push({ kind: 'h1', text: `M.V. ${(voyage.vesselName || '').toUpperCase()} VOY ${voyage.voyageNumber || ''}`.trim() })
    out.push({ kind: 'p', text: `${voyage.cargoType || 'DRI'} Production Report`, bold: true })
    if (opts?.reportNumber) out.push({ kind: 'p', text: `Report No. ${opts.reportNumber}`, bold: true })
    const commenced = dri.commencedOn || voyage.startDate
    const completed = dri.completedOn || voyage.endDate
    out.push({ kind: 'p', text: `PRODUCTION REPORT COMMENCED ${fmtDate(commenced)}${completed ? `  /  COMPLETED ${fmtDate(completed)}` : ''}` })
  }
  if (has('preliminary_meeting') && dri.preliminaryMeeting && (dri.preliminaryMeeting.notes || dri.preliminaryMeeting.meetingDate)) {
    out.push({ kind: 'h2', text: 'PRELIMINARY MEETING' })
    if (dri.preliminaryMeeting.meetingDate) out.push({ kind: 'p', text: `Date: ${fmtDate(dri.preliminaryMeeting.meetingDate)}` })
    if (dri.preliminaryMeeting.notes) out.push({ kind: 'p', text: dri.preliminaryMeeting.notes })
  }
  if (has('ultrasonic_hatch') && dri.ultrasonicHatchTests.length) {
    const first = dri.ultrasonicHatchTests[0]
    out.push({ kind: 'h2', text: `ULTRASONIC HATCH TESTING${first.testDate ? ' ' + fmtDate(first.testDate) : ''}` })
    for (const t of dri.ultrasonicHatchTests) out.push({ kind: 'p', text: `${t.testDate ? fmtDate(t.testDate) + ': ' : ''}${t.notes || 'Hatch covers ultrasonically tested.'}` })
  }
  if (has('stockpile') && dri.stockpileInspections.length) {
    out.push({ kind: 'h2', text: 'STOCK PILE INSPECTION' })
    for (const s of dri.stockpileInspections) out.push({ kind: 'p', text: `${s.inspectedOn ? fmtDT(s.inspectedOn) + ': ' : ''}${s.description}` })
  }
  if (has('hold_inspections') && dri.holdInspections.length) {
    out.push({ kind: 'h2', text: 'HOLD INSPECTIONS' })
    for (const h of dri.holdInspections) out.push({ kind: 'p', text: `Hold ${h.holdNo}: ${h.conditionText}` })
  }
  if (has('tc_wire_installation') && dri.tcWireInstalls.length) {
    out.push({ kind: 'h2', text: 'THERMOCOUPLE WIRE INSTALLATION' })
    out.push({ kind: 'table', headers: ['DATE', 'HOLD NO.', 'WIRING SEQ.', 'START', 'COMPLETED'], rows: dri.tcWireInstalls.map(t => [fmtDate(t.installDate), String(t.holdNo), t.wiringSeq, t.startTime, t.completedTime]) })
  }
  if (has('tc_wire_lengths') && dri.tcWireLengths.length) {
    out.push({ kind: 'h2', text: 'THERMOCOUPLE WIRE LENGTHS' })
    out.push({ kind: 'table', headers: ['WIRING LEVEL', 'HOLDS', 'TC #', 'LENGTH'], rows: dri.tcWireLengths.map(t => [t.wiringLevel, t.appliesToHolds, String(t.tcNumber), `${t.lengthValue} ${t.lengthUnit}`]) })
  }
  if (has('sof_load')) {
    out.push({ kind: 'h2', text: `CARGO OPS & BALLAST CONDITIONS: ${(voyage.loadingPort || 'LOAD PORT').toUpperCase()} (LOAD PORT)` })
    const ev = dri.sofEvents.filter(e => e.phase === 'LOAD')
    if (ev.length) sofBlocks(ev, out); else out.push({ kind: 'p', text: 'No events logged.' })
  }
  if (has('ir_load')) {
    const ir = dri.irReadings.filter(r => r.phase === 'LOAD')
    if (ir.length) {
      out.push({ kind: 'h2', text: 'IR GUN READINGS — LOADING' })
      out.push({ kind: 'table', headers: ['DATE', 'TIME', 'HOLD', 'FWD °C', 'MID °C', 'AFT °C'], rows: ir.map(r => [fmtDate(r.readingDate), r.readingTime, String(r.holdNo), numStr(r.fwdC), numStr(r.midC), numStr(r.aftC)]) })
    }
  }
  if (has('inerting') && dri.inerting.length) {
    out.push({ kind: 'h2', text: 'INERTING REPORT' })
    out.push({ kind: 'table', headers: ['HOLD', 'COMMENCED', 'COMPLETED', 'TOTAL TIME', 'OXYGEN %'], rows: dri.inerting.map(t => [String(t.holdNo), fmtDT(t.commencedAt), fmtDT(t.completedAt), `${t.totalHours}h ${t.totalMinutes}m`, String(t.oxygenPct)]) })
  }
  if (has('voyage_log') && dri.voyageLog.length) {
    out.push({ kind: 'h2', text: 'VOYAGE' })
    const byDate = new Map<string, typeof dri.voyageLog>()
    for (const e of dri.voyageLog) { const g = byDate.get(e.logDate) ?? []; g.push(e); byDate.set(e.logDate, g) }
    for (const d of [...byDate.keys()].sort()) {
      out.push({ kind: 'p', text: fmtDate(d), bold: true })
      for (const e of byDate.get(d)!.sort((a, b) => a.slot.localeCompare(b.slot))) {
        const sentence = e.readingsTaken
          ? `${e.slot} hrs — readings taken for ${e.holdsList || 'all holds'}. Weather ${e.weather}, sea ${e.seaState}. Sealing foam ${e.sealingFoamOk ? 'in good order' : 'NOT in good order'}.${e.slot === '1800' && e.atmosphericTempC != null ? ` Atmospheric temperature ${e.atmosphericTempC}°C.` : ''}`
          : `${e.slot} hrs — ${e.note || 'readings could not be taken'}.`
        out.push({ kind: 'p', text: sentence })
      }
    }
  }
  if (has('sof_discharge')) {
    out.push({ kind: 'h2', text: `CARGO OPS & BALLAST CONDITIONS: DISCHARGE PORT${voyage.dischargePort ? ', ' + voyage.dischargePort.toUpperCase() : ''}` })
    const ev = dri.sofEvents.filter(e => e.phase === 'DISCHARGE')
    if (ev.length) sofBlocks(ev, out); else out.push({ kind: 'p', text: 'No events logged.' })
  }
  if (has('hold_openings') && dri.holdOpenings.length) {
    out.push({ kind: 'h2', text: 'HOLD OPENINGS' })
    for (const h of dri.holdOpenings) {
      const ir = (h.irFwdC != null || h.irMidC != null || h.irAftC != null) ? ` IR Fwd ${numStr(h.irFwdC)}°C, Mid ${numStr(h.irMidC)}°C, Aft ${numStr(h.irAftC)}°C.` : ''
      out.push({ kind: 'p', text: `Hold ${h.holdNo} opened ${fmtDT(h.openedAt)}: cargo was ${h.cargoCondition}.${ir}${h.condensation ? ' Condensation noted.' : ''}${h.notes ? ' ' + h.notes : ''}` })
    }
  }
  if (has('ir_discharge')) {
    const ir = dri.irReadings.filter(r => r.phase === 'DISCHARGE')
    if (ir.length) {
      out.push({ kind: 'h2', text: 'IR GUN READINGS — DISCHARGE' })
      out.push({ kind: 'table', headers: ['DATE', 'TIME', 'HOLD', 'FWD °C', 'MID °C', 'AFT °C'], rows: ir.map(r => [fmtDate(r.readingDate), r.readingTime, String(r.holdNo), numStr(r.fwdC), numStr(r.midC), numStr(r.aftC)]) })
    }
  }
  if (has('barge_list') && dri.barges.length) {
    const loc = dri.barges[0]?.location
    out.push({ kind: 'h2', text: `BARGE LIST${loc ? ' ' + loc.toUpperCase() : ''}` })
    out.push({ kind: 'table', headers: ['BARGE', 'HOLD', 'COMMENCE', 'COMPLETED'], rows: dri.barges.map(b => [b.bargeId, b.holds, fmtDT(b.commenceAt), fmtDT(b.completedAt)]) })
  }
  if (has('temp_gas_summary')) {
    const rows = summarizeReadings(voyage)
    if (rows.length) {
      out.push({ kind: 'h2', text: 'TEMPERATURE & GAS READINGS' })
      out.push({ kind: 'table', headers: ['READING', 'HOLD', 'MIN', 'MAX', 'AVG', 'UNIT'], rows })
    }
  }
  if (has('signoff')) {
    out.push({ kind: 'p', text: ' ' })
    out.push({ kind: 'p', text: voyage.surveyorName || '', bold: true })
    out.push({ kind: 'p', text: dri.surveyorTitle || DEFAULT_SURVEYOR_TITLE })
  }
  return out
}
