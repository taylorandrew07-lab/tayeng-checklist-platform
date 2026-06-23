// DRI Production Report — structured report sections layered onto the existing
// offline-first cargo Voyage document. Nothing here is relational: every section
// is an array/object stored inside `Voyage.dri`, so the whole report is captured
// at sea (no signal) and synced as part of the voyage doc, exactly like readings.
//
// The existing sensor readings (thermocouple / IR / O2 / CO / H2) are NOT
// duplicated here — the report's "Temperature & Gas" section reads them straight
// from Voyage.readings.

import type { Period, Voyage } from './types'

export type SofPhase = 'LOAD' | 'DISCHARGE'
export type LengthUnit = 'm' | 'ft'
export type WiringSeq = 'Base' | 'Level 1' | 'Level 2' | 'Level 1 & 2' | 'Mid Level' | 'Surface'
export type Weather = 'clear and sunny' | 'overcast' | 'cloudy' | 'foggy'
export type SeaState = 'calm' | 'moderate' | 'rough' | 'very rough'
export type ReadingStatus = 'taken' | 'not_taken' | 'could_not'
export type ReasonNotTaken = 'rain' | 'rough seas' | 'strong winds' | 'unsafe deck' | 'other'

// ── Section record shapes ────────────────────────────────────────────────────
export interface PreliminaryMeeting { notes: string; meetingDate?: string }
export interface UltrasonicHatchTest { id: string; testDate: string; notes?: string }
export interface StockpileInspection { id: string; inspectedOn: string; description: string }
export interface HoldInspection { holdNo: number; conditionText: string; clean: boolean }
export interface TcWireInstall { id: string; installDate: string; holdNo: number; wiringSeq: WiringSeq; startTime: string; completedTime: string }
export interface TcWireLength { id: string; wiringLevel: string; appliesToHolds: string; tcNumber: number; lengthValue: number; lengthUnit: LengthUnit }
export interface Inerting { id: string; holdNo: number; commencedAt: string; completedAt: string; totalHours: number; totalMinutes: number; oxygenPct: number }
export interface VoyageLogEntry {
  id: string; logDate: string; slot: Period; readingsTaken: boolean; holdsList: string
  weather: Weather; seaState: SeaState; sealingFoamOk: boolean
  atmosphericTempC?: number | null // only captured at the 1800 slot
  note?: string // for "could not be taken due to…" cases
  // 3-way status refines the legacy `readingsTaken` boolean (kept for back-compat:
  // when readingStatus is absent, readingsTaken is the source of truth).
  readingStatus?: ReadingStatus
  reasonNotTaken?: ReasonNotTaken
}
/** Statement of Facts — one timestamped event, shared by LOAD and DISCHARGE. */
export interface SofEvent { id: string; phase: SofPhase; eventDate: string; eventTime: string; eventText: string; holdNo?: number | null; sortOrder: number }
/** IR gun reading row (per hold, Fwd/Mid/Aft), phase-scoped. */
export interface IrReading { id: string; phase: SofPhase; readingDate: string; readingTime: string; holdNo: number; fwdC?: number | null; midC?: number | null; aftC?: number | null }
export interface HoldOpening { id: string; holdNo: number; openedAt: string; condensation: boolean; cargoCondition: string; irFwdC?: number | null; irMidC?: number | null; irAftC?: number | null; notes?: string }
export interface Barge { id: string; location: string; bargeId: string; holds: string; commenceAt: string; completedAt: string }

// ── Report section keys (stable — used by saved report configs) ──────────────
export type SectionKey =
  | 'header' | 'preliminary_meeting' | 'ultrasonic_hatch' | 'stockpile' | 'hold_inspections'
  | 'tc_wire_installation' | 'tc_wire_lengths' | 'sof_load' | 'ir_load' | 'inerting'
  | 'voyage_log' | 'sof_discharge' | 'hold_openings' | 'ir_discharge' | 'barge_list'
  | 'temp_gas_summary' | 'signoff' | 'photos'

/** A saved checklist selection so a report can be regenerated identically. */
export interface ReportConfig { name: string; includedSections: SectionKey[]; options?: Record<string, unknown>; createdAt: number }

/** All DRI report sections, stored at Voyage.dri. Sensor readings are NOT here. */
export interface DriReport {
  surveyorTitle?: string
  commencedOn?: string // production report commenced (date)
  completedOn?: string
  preliminaryMeeting?: PreliminaryMeeting
  ultrasonicHatchTests: UltrasonicHatchTest[]
  stockpileInspections: StockpileInspection[]
  holdInspections: HoldInspection[]
  tcWireInstalls: TcWireInstall[]
  tcWireLengths: TcWireLength[]
  inerting: Inerting[]
  voyageLog: VoyageLogEntry[]
  sofEvents: SofEvent[]   // both phases; filter by phase
  irReadings: IrReading[] // both phases; filter by phase
  holdOpenings: HoldOpening[]
  barges: Barge[]
  reportConfig?: ReportConfig
}

// ── Defaults / standard sentences ────────────────────────────────────────────
export const DEFAULT_HOLD_CONDITION = 'tank top and bilge wells were clean and dry'
export const DEFAULT_CARGO_CONDITION_OPENING = 'clean, dry, and light grey'
export const DEFAULT_SURVEYOR_TITLE = 'Paul L. Taylor. Dip.Mar.Sur. MIIMS. / Managing Director.'
export const DEFAULT_OXYGEN_PCT = 3

// ── Controlled vocab (dropdowns) ─────────────────────────────────────────────
export const WIRING_SEQS: WiringSeq[] = ['Base', 'Level 1', 'Level 2', 'Level 1 & 2', 'Mid Level', 'Surface']
export const WEATHER_OPTIONS: Weather[] = ['clear and sunny', 'overcast', 'cloudy', 'foggy']
export const SEA_STATE_OPTIONS: SeaState[] = ['calm', 'moderate', 'rough', 'very rough']
export const LENGTH_UNITS: LengthUnit[] = ['m', 'ft']
export const READING_STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: 'taken', label: 'Taken' },
  { value: 'not_taken', label: 'Not taken' },
  { value: 'could_not', label: 'Could not take' },
]
export const REASON_NOT_TAKEN: ReasonNotTaken[] = ['rain', 'rough seas', 'strong winds', 'unsafe deck', 'other']

/** Read a log entry's effective status (back-compat: fall back to the boolean). */
export function readingStatusOf(e: VoyageLogEntry): ReadingStatus {
  return e.readingStatus ?? (e.readingsTaken ? 'taken' : 'could_not')
}

/** Whole hours + minutes between two datetime-local/ISO strings (null if invalid). */
export function durationHM(startISO?: string, endISO?: string): { hours: number; minutes: number } | null {
  if (!startISO || !endISO) return null
  const a = new Date(startISO).getTime(); const b = new Date(endISO).getTime()
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null
  const mins = Math.round((b - a) / 60000)
  return { hours: Math.floor(mins / 60), minutes: mins % 60 }
}

// SOF autocomplete vocab. `#_` prompts for a hold number on entry.
export const SOF_LOAD_EVENTS = [
  'All fast', 'Gangway up', 'Initial draught survey', 'Interim draught survey', 'Final draught survey',
  'All clear to load', 'Opening #_ manhole fwd', 'Opening #_ manhole aft', 'Closing #_ manhole fwd', 'Closing #_ manhole aft',
  'Positioning loading arm', 'Commence loading hold #_', 'Resume loading hold #_',
  'Awaiting shifting', 'Commence shifting', 'Complete shifting',
  'Threat of rain', 'Rain', 'Shoreside delay (___)', 'Chief checking draft', 'Loading completed',
]
export const SOF_DISCHARGE_EVENTS = [
  'Pilot on board', 'All fast', 'Vessel on standby', 'Hold #_ opened',
  'Commence discharging hold #_', 'Suspend discharging hold #_', 'Resume discharging hold #_', 'Complete discharging hold #_',
  'Shifting', 'Threat of rain', 'Rain', 'Vessel complete discharging operations',
]
export const sofVocab = (phase: SofPhase) => (phase === 'LOAD' ? SOF_LOAD_EVENTS : SOF_DISCHARGE_EVENTS)

// ── Canonical render order + labels ──────────────────────────────────────────
export const CANONICAL_ORDER: SectionKey[] = [
  'header', 'preliminary_meeting', 'ultrasonic_hatch', 'stockpile', 'hold_inspections',
  'tc_wire_installation', 'tc_wire_lengths', 'sof_load', 'ir_load', 'inerting',
  'voyage_log', 'sof_discharge', 'hold_openings', 'ir_discharge', 'barge_list',
  'temp_gas_summary', 'signoff', 'photos',
]
export const SECTION_LABELS: Record<SectionKey, string> = {
  header: 'Header',
  preliminary_meeting: 'Preliminary meeting',
  ultrasonic_hatch: 'Ultrasonic hatch testing',
  stockpile: 'Stock pile inspection',
  hold_inspections: 'Hold inspections',
  tc_wire_installation: 'Thermocouple wire installation',
  tc_wire_lengths: 'Thermocouple wire lengths',
  sof_load: 'Cargo ops & ballast — load port (SOF + IR)',
  ir_load: 'IR readings — load',
  inerting: 'Inerting report',
  voyage_log: 'Voyage (daily log)',
  sof_discharge: 'Cargo ops & ballast — discharge (SOF + hold openings + IR)',
  hold_openings: 'Hold openings',
  ir_discharge: 'IR readings — discharge',
  barge_list: 'Barge list',
  temp_gas_summary: 'Temperature & gas readings summary (from sensors)',
  signoff: 'Sign-off',
  photos: 'Photographs (appendix)',
}

// ── Constructors ─────────────────────────────────────────────────────────────
export function defaultHoldInspections(holdCount: number): HoldInspection[] {
  return Array.from({ length: holdCount }, (_, i) => ({ holdNo: i + 1, conditionText: DEFAULT_HOLD_CONDITION, clean: true }))
}

export function emptyDriReport(holdCount = 5): DriReport {
  return {
    surveyorTitle: DEFAULT_SURVEYOR_TITLE,
    ultrasonicHatchTests: [],
    stockpileInspections: [],
    holdInspections: defaultHoldInspections(holdCount),
    tcWireInstalls: [],
    tcWireLengths: [],
    inerting: [],
    voyageLog: [],
    sofEvents: [],
    irReadings: [],
    holdOpenings: [],
    barges: [],
  }
}

/** Backfill the dri object (and any newly-added arrays) on an existing voyage. */
export function ensureDri(dri: DriReport | undefined, holdCount: number): DriReport {
  const base = emptyDriReport(holdCount)
  if (!dri) return base
  return {
    ...base,
    ...dri,
    ultrasonicHatchTests: dri.ultrasonicHatchTests ?? [],
    stockpileInspections: dri.stockpileInspections ?? [],
    holdInspections: dri.holdInspections?.length ? dri.holdInspections : base.holdInspections,
    tcWireInstalls: dri.tcWireInstalls ?? [],
    tcWireLengths: dri.tcWireLengths ?? [],
    inerting: dri.inerting ?? [],
    voyageLog: dri.voyageLog ?? [],
    sofEvents: dri.sofEvents ?? [],
    irReadings: dri.irReadings ?? [],
    holdOpenings: dri.holdOpenings ?? [],
    barges: dri.barges ?? [],
  }
}

/** Default sections to tick on a fresh report: everything except optional ones
 *  (stockpile, the sensor summary, and the photo appendix are opt-in). */
export const DEFAULT_INCLUDED: SectionKey[] = CANONICAL_ORDER.filter(k => k !== 'stockpile' && k !== 'temp_gas_summary' && k !== 'photos')

// ── Completeness check ───────────────────────────────────────────────────────
// Before generating/finalizing, warn about ticked sections that have no data, so
// a report isn't issued with an empty "Inerting" or "Voyage log" heading. This is
// advisory only — the user can still generate (some reports legitimately omit a
// section's data but keep the heading). `header` and `signoff` are always assumed
// intentional and never flagged.

/** True if any sensor reading has been entered anywhere in the voyage. */
function hasAnyReadings(voyage: Voyage): boolean {
  const byDate = voyage.readings
  if (!byDate) return false
  for (const byPeriod of Object.values(byDate))
    for (const byHold of Object.values(byPeriod))
      for (const byType of Object.values(byHold))
        for (const byPoint of Object.values(byType))
          for (const v of Object.values(byPoint))
            if (v != null && String(v).trim() !== '') return true
  return false
}

export interface CompletenessWarning { key: SectionKey; label: string; message: string }

/** Return one warning per ticked section that has no underlying data.
 *  `photoCount` is supplied separately because photos live outside the voyage doc;
 *  pass undefined when unknown so the photo appendix is not falsely flagged. */
export function completenessWarnings(voyage: Voyage, included: SectionKey[], photoCount?: number): CompletenessWarning[] {
  const dri = ensureDri(voyage.dri, voyage.holdCount)
  const has = (k: SectionKey): boolean => {
    switch (k) {
      case 'header':
      case 'signoff': return true
      case 'photos': return photoCount == null ? true : photoCount > 0
      case 'preliminary_meeting': return !!dri.preliminaryMeeting?.notes?.trim()
      case 'ultrasonic_hatch': return dri.ultrasonicHatchTests.length > 0
      case 'stockpile': return dri.stockpileInspections.length > 0
      case 'hold_inspections': return dri.holdInspections.length > 0
      case 'tc_wire_installation': return dri.tcWireInstalls.length > 0
      case 'tc_wire_lengths': return dri.tcWireLengths.length > 0
      case 'inerting': return dri.inerting.length > 0
      case 'voyage_log': return dri.voyageLog.length > 0
      case 'sof_load': return dri.sofEvents.some(e => e.phase === 'LOAD')
      case 'sof_discharge': return dri.sofEvents.some(e => e.phase === 'DISCHARGE')
      case 'ir_load': return dri.irReadings.some(e => e.phase === 'LOAD')
      case 'ir_discharge': return dri.irReadings.some(e => e.phase === 'DISCHARGE')
      case 'hold_openings': return dri.holdOpenings.length > 0
      case 'barge_list': return dri.barges.length > 0
      case 'temp_gas_summary': return hasAnyReadings(voyage)
    }
  }
  return included
    .filter(k => !has(k))
    .map(k => ({ key: k, label: SECTION_LABELS[k], message: `${SECTION_LABELS[k]} is ticked but has no data entered.` }))
}

// ── Pre-export validation ────────────────────────────────────────────────────
// Stronger checks than the empty-section warnings: data integrity (dates, hold
// numbers) + key operational milestones. Advisory (export is never hard-blocked),
// but surfaced prominently so a report isn't issued missing its anchors.
export interface ReportIssue { severity: 'warn' | 'error'; message: string }

export function validateReport(voyage: Voyage, included: SectionKey[]): ReportIssue[] {
  const dri = ensureDri(voyage.dri, voyage.holdCount)
  const has = (k: SectionKey) => included.includes(k)
  const hc = voyage.holdCount
  const issues: ReportIssue[] = []

  const commenced = dri.commencedOn || voyage.startDate
  const completed = dri.completedOn || voyage.endDate
  if (commenced && completed && completed < commenced) {
    issues.push({ severity: 'error', message: 'Report completed date is before the commenced date.' })
  }

  const outOfRange = (n: number) => !Number.isFinite(n) || n < 1 || n > hc
  const countBad = (ns: number[]) => ns.filter(outOfRange).length
  const badIr = countBad(dri.irReadings.map(r => r.holdNo))
  if (badIr) issues.push({ severity: 'warn', message: `${badIr} IR reading(s) reference a hold outside 1–${hc}.` })
  const badInert = countBad(dri.inerting.map(r => r.holdNo))
  if (badInert) issues.push({ severity: 'warn', message: `${badInert} inerting row(s) reference a hold outside 1–${hc}.` })
  const badOpen = countBad(dri.holdOpenings.map(r => r.holdNo))
  if (badOpen) issues.push({ severity: 'warn', message: `${badOpen} hold opening(s) reference a hold outside 1–${hc}.` })

  const loadText = dri.sofEvents.filter(e => e.phase === 'LOAD').map(e => e.eventText.toLowerCase()).join(' | ')
  const dischText = dri.sofEvents.filter(e => e.phase === 'DISCHARGE').map(e => e.eventText.toLowerCase()).join(' | ')
  if (has('sof_load')) {
    if (!/final draught survey/.test(loadText)) issues.push({ severity: 'warn', message: 'No "final draught survey" event logged at the load port.' })
    if (!/loading completed/.test(loadText)) issues.push({ severity: 'warn', message: 'No "loading completed" event logged at the load port.' })
  }
  if (has('sof_discharge')) {
    if (!/complete discharging|discharge completed/.test(dischText)) issues.push({ severity: 'warn', message: 'No "discharge completed" event logged at the discharge port.' })
  }
  return issues
}
