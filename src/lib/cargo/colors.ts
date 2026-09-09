// Temperature colour coding. Absolute bands are solid (e.g. ≥60 amber, ≥65 red);
// below the amber band, an optional gradient blends green→amber based on the daily
// rate of rise (compared to the same period 24 h earlier). Light tints + dark text
// keep it readable and not alarming.
//
// The red band is OPTIONAL: some cargoes have a single "watch it" temperature and
// no second, worse one. A red of 0 means the band does not exist — no red cell, no
// red threshold line on the charts, no red entry in the key. hasRedBand() is the
// one place that decides, so nothing can disagree about it.

import { parseISO, format, subDays, isValid } from 'date-fns'
import { getReadingValue, type Voyage, type ReadingType, type Period, type ColorRules } from './types'

export interface CellColor { bg: string; fg: string }

const GREEN: CellColor = { bg: '#dcfce7', fg: '#166534' }
const AMBER: CellColor = { bg: '#fef9c3', fg: '#854d0e' }
const RED: CellColor = { bg: '#fee2e2', fg: '#991b1b' }

function hexToRgb(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
}
function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const c = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, '0')
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`
}

/** Whether these rules have a red band at all. 0 (or a missing/NaN value) means
 *  "amber only" — see the note at the top of this file. Deliberately `!== 0` and
 *  not `> 0`, so a genuine sub-zero threshold on refrigerated cargo still works. */
export function hasRedBand(rules: ColorRules): boolean {
  return Number.isFinite(rules.red) && rules.red !== 0
}

/** Resolve a value (+ optional 24 h-earlier value) to a cell colour. */
export function evaluateCellColor(value: number, prevValue: number | null, rules: ColorRules): CellColor {
  if (hasRedBand(rules) && value >= rules.red) return RED
  if (value >= rules.amber) return AMBER
  if (rules.rateDeltaC && prevValue != null) {
    const rise = value - prevValue
    if (rise >= rules.rateDeltaC) return AMBER // solid amber once the 24 h jump is met
    if (rules.gradient && rise > 0) {
      const t = Math.min(1, rise / rules.rateDeltaC)
      return { bg: lerpHex(GREEN.bg, AMBER.bg, t), fg: GREEN.fg }
    }
  }
  return GREEN
}

/**
 * Colour for a specific reading cell, or null if colouring is off / not numeric /
 * the reading type has no rules. The rate comparison uses the same period on the
 * previous calendar day (≈24 h).
 */
export function readingCellColor(
  voyage: Voyage, rt: ReadingType, hold: number, date: string, period: Period, ptId: string
): CellColor | null {
  if (voyage.showColors === false || !rt.colorRules) return null
  const raw = getReadingValue(voyage, date, period, hold, rt.id, ptId)
  if (raw === '') return null
  const v = parseFloat(raw)
  if (!Number.isFinite(v)) return null

  let prev: number | null = null
  const d = parseISO(date)
  if (isValid(d)) {
    const prevRaw = getReadingValue(voyage, format(subDays(d, 1), 'yyyy-MM-dd'), period, hold, rt.id, ptId)
    const pv = parseFloat(prevRaw)
    if (Number.isFinite(pv)) prev = pv
  }
  return evaluateCellColor(v, prev, rt.colorRules)
}

/** Default DRI-style rules used when a surveyor first enables colouring on a type. */
export function defaultColorRules(): ColorRules {
  return { amber: 60, red: 65, rateDeltaC: 10, gradient: true }
}
