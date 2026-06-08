// Cargo Hold Monitoring — local-first data shapes stored in IndexedDB.
// Everything here is browser-local (the slice has no Supabase voyage tables yet);
// cloud sync is a later phase. All voyage/photo records are scoped by `userId`.

/** The three nominal monitoring periods. Actual reading times may differ and are
 *  captured separately (periodMeta.actualTime + per-photo actualTime). */
export type Period = '0600' | '1200' | '1800'
export const PERIODS: Period[] = ['0600', '1200', '1800']
export const PERIOD_LABELS: Record<Period, string> = {
  '0600': '0600 hrs',
  '1200': '1200 hrs',
  '1800': '1800 hrs',
}

export type Camera = 'fwd' | 'aft'
export const CAMERA_LABELS: Record<Camera, string> = { fwd: 'Forward', aft: 'Aft' }

export type VoyageStatus = 'in_progress' | 'finalized'

/** Point id used for single-value reading types (gases etc.) and legacy data. */
export const SINGLE_POINT_ID = 'main'

/** One measurement channel within a reading type, recorded per hold per period.
 *  e.g. a thermocouple "TC 7" in group "LVL 2", or an IR camera "Zone 3". */
export interface ReadingPoint {
  id: string
  name: string
  /** Optional location/grouping label, e.g. BTM / LVL 1 / LVL 2 / TOP / AMB. */
  group?: string
}

/** Threshold rules that colour a reading value green/amber/red. Presence on a
 *  reading type enables colouring for it; the voyage-level toggle can hide it. */
export interface ColorRules {
  /** value ≥ amber → at least amber (solid). e.g. 60 */
  amber: number
  /** value ≥ red → red (solid). e.g. 65 */
  red: number
  /** A rise ≥ this vs the same period 24 h earlier → amber. e.g. 10 */
  rateDeltaC?: number
  /** Blend green→amber for sub-threshold daily rises (absolute bands stay solid). */
  gradient?: boolean
}

/** A configurable reading (temperature/gas/custom). New types need no code change.
 *  A type owns one or more named points; single-value types have one point. */
export interface ReadingType {
  id: string
  name: string
  unit: string
  description?: string
  /** 'all' holds, or a specific list of hold numbers it applies to. */
  appliesTo: 'all' | number[]
  includeInTables: boolean
  includeInCharts: boolean
  includeInPdf: boolean
  /** Default reading types are seeded; surveyors may still edit/remove them. */
  builtIn?: boolean
  /** One or more measurement channels. Always length >= 1 after normalization. */
  points: ReadingPoint[]
  /** When set, values are colour-coded by these thresholds (e.g. temperatures). */
  colorRules?: ColorRules
}

/**
 * A reusable Cargo Monitoring template (admin-managed, stored in Supabase and
 * cached locally for offline voyage creation). Config only: the reading-type set
 * and a default hold count. Voyages snapshot this config at creation.
 */
export interface CargoTemplate {
  id: string
  name: string
  description: string | null
  default_hold_count: number
  reading_types: ReadingType[]
  status: 'draft' | 'active' | 'archived'
  created_by?: string | null
  created_at?: string
  updated_at?: string
}

/** Per date+period operational metadata (actual time the round was walked, notes). */
export interface PeriodMeta {
  actualTime?: string
  remarks?: string
  /** Set once the surveyor has reviewed and confirmed this period's photo set. */
  photosConfirmed?: boolean
}

/**
 * One voyage report. Readings are kept inline as a nested map keyed by
 * date → period → holdNumber → readingTypeId → pointId so the whole report
 * loads/saves as a single IndexedDB document. Photos live in a separate store.
 */
export interface Voyage {
  id: string
  userId: string

  /** The cargo template this voyage was created from (null = blank). readingTypes
   *  below is a snapshot taken at creation, so later template edits never alter it. */
  templateId?: string | null
  templateName?: string

  // --- Setup ---
  vesselName: string
  voyageNumber: string
  cargoType: string
  loadingPort: string
  dischargePort: string
  startDate: string // ISO yyyy-mm-dd
  endDate: string // ISO yyyy-mm-dd
  holdCount: number // 1–10
  surveyorName: string
  /** Linked client id from the Clients list (null = none / free text). */
  clientId?: string | null
  clientName?: string
  remarks?: string
  /** Master toggle for temperature colour coding (default on). */
  showColors?: boolean
  /** Publish state. Until 'finalized', views/PDFs are marked NOT FINALISED. */
  status?: VoyageStatus
  /** Epoch ms of the last successful push to Supabase (undefined = never). */
  lastSyncedAt?: number

  // --- Config ---
  readingTypes: ReadingType[]

  // --- Data ---
  /** readings[dateISO][period][holdNumber][readingTypeId][pointId] = entered value */
  readings: Record<string, Record<string, Record<string, Record<string, Record<string, string>>>>>
  /** periodMeta[dateISO][period] = { actualTime, remarks } */
  periodMeta: Record<string, Record<string, PeriodMeta>>
  observations?: string

  createdAt: number
  updatedAt: number
}

/** A photograph queued/stored for a voyage. Full-resolution blob retained; the
 *  compressed copy embedded in the PDF is produced at render time. */
export interface CargoPhoto {
  localId: string
  voyageId: string
  userId: string
  dateISO: string
  period: Period
  /** null while sitting in the Unassigned bin. */
  holdNumber: number | null
  camera: Camera | null
  /** "HH:mm" derived from EXIF when available; editable by the surveyor. */
  actualTime: string | null
  filename: string
  blob: Blob
  assigned: boolean
  /** Stable ordering within its slot / the unassigned bin. */
  order: number
  createdAt: number
  /** Sync state: true once the blob is uploaded to Storage. */
  uploaded?: boolean
  storagePath?: string | null
}

export const HOLD_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export const DEFAULT_HOLD_COUNT = 5

/** Default reading set seeded into every new voyage/template; fully editable.
 *  Temperature/gas colour rules reflect DRI defaults (all directions: higher = worse). */
export function defaultReadingTypes(): ReadingType[] {
  const single = (): ReadingPoint[] => [{ id: SINGLE_POINT_ID, name: '' }]
  const temp: ColorRules = { amber: 60, red: 65, rateDeltaC: 10, gradient: true }
  return [
    {
      id: 'rt_thermocouple', name: 'Thermocouple Temperature', unit: '°C', appliesTo: 'all',
      includeInTables: true, includeInCharts: false, includeInPdf: true, builtIn: true,
      points: [{ id: 'tc_1', name: 'TC 1' }], colorRules: { ...temp },
    },
    {
      id: 'rt_ir_camera', name: 'Infrared Camera', unit: '°C', appliesTo: 'all',
      includeInTables: true, includeInCharts: false, includeInPdf: true, builtIn: true,
      points: Array.from({ length: 9 }, (_, i) => ({ id: `zone_${i + 1}`, name: `Zone ${i + 1}` })), colorRules: { ...temp },
    },
    {
      id: 'rt_ir_gun', name: 'Infrared Gun', unit: '°C', appliesTo: 'all',
      includeInTables: true, includeInCharts: false, includeInPdf: true, builtIn: true,
      points: [{ id: 'ir_fwd', name: 'Fwd' }, { id: 'ir_mid', name: 'Mid' }, { id: 'ir_aft', name: 'Aft' }], colorRules: { ...temp },
    },
    {
      id: 'rt_oxygen', name: 'Oxygen', unit: '%', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true,
      points: single(), colorRules: { amber: 4, red: 5, rateDeltaC: 2, gradient: true },
    },
    { id: 'rt_co', name: 'Carbon Monoxide', unit: 'ppm', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true, points: single() },
    { id: 'rt_hydrogen', name: 'Hydrogen', unit: '%', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true, points: single() },
    {
      id: 'rt_lel', name: 'H₂ LEL', unit: '%', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true,
      points: single(), colorRules: { amber: 20, red: 25, rateDeltaC: 5, gradient: true },
    },
  ]
}

/** Whether a reading type collects a value for a given hold. */
export function readingTypeAppliesToHold(rt: ReadingType, holdNumber: number): boolean {
  return rt.appliesTo === 'all' || rt.appliesTo.includes(holdNumber)
}

/** True when a reading type is a single unnamed value (no per-point labels). */
export function isSinglePoint(rt: ReadingType): boolean {
  return rt.points.length === 1 && !rt.points[0].name
}

/** Ensure every reading type has at least one point (migrates pre-points data). */
export function normalizeReadingTypes(types: ReadingType[] | undefined | null): ReadingType[] {
  return (types ?? []).map(rt =>
    rt.points && rt.points.length ? rt : { ...rt, points: [{ id: SINGLE_POINT_ID, name: '' }] }
  )
}

/**
 * Deep-copy reading types for a voyage snapshot so it never aliases the source
 * template's arrays (later template edits must not mutate existing voyages).
 * Tolerates pre-points data by defaulting to a single value.
 */
export function cloneReadingTypes(types: ReadingType[]): ReadingType[] {
  return types.map(rt => ({
    ...rt,
    appliesTo: rt.appliesTo === 'all' ? 'all' : [...rt.appliesTo],
    points: (rt.points && rt.points.length ? rt.points : [{ id: SINGLE_POINT_ID, name: '' }]).map(p => ({ ...p })),
    colorRules: rt.colorRules ? { ...rt.colorRules } : undefined,
  }))
}

/** Read one value from the nested readings map. */
export function getReadingValue(v: Voyage, date: string, period: Period, hold: number, rtId: string, ptId: string): string {
  return v.readings?.[date]?.[period]?.[String(hold)]?.[rtId]?.[ptId] ?? ''
}

/** Immutably set one value in the nested readings map. */
export function setReadingValue(v: Voyage, date: string, period: Period, hold: number, rtId: string, ptId: string, value: string): Voyage {
  const readings = { ...v.readings }
  const d = { ...(readings[date] ?? {}) }
  const p = { ...(d[period] ?? {}) }
  const h = { ...(p[String(hold)] ?? {}) }
  const t = { ...(h[rtId] ?? {}) }
  t[ptId] = value
  h[rtId] = t
  p[String(hold)] = h
  d[period] = p
  readings[date] = d
  return { ...v, readings }
}

/**
 * Bring older voyages forward to the points-based shape:
 *  - every reading type gets at least one point;
 *  - legacy readings stored as `[rtId] = string` become `[rtId][main] = string`.
 * Returns the same object when nothing needed migrating.
 */
export function normalizeVoyage(v: Voyage): Voyage {
  let changed = false

  const readingTypes = v.readingTypes.map(rt => {
    if (rt.points && rt.points.length) return rt
    changed = true
    return { ...rt, points: [{ id: SINGLE_POINT_ID, name: '' }] }
  })

  const readings: Voyage['readings'] = {}
  for (const [date, byPeriod] of Object.entries(v.readings ?? {})) {
    readings[date] = {}
    for (const [period, byHold] of Object.entries(byPeriod ?? {})) {
      readings[date][period] = {}
      for (const [hold, byType] of Object.entries(byHold ?? {})) {
        readings[date][period][hold] = {}
        for (const [rtId, val] of Object.entries(byType ?? {})) {
          if (typeof val === 'string') { // legacy single value
            changed = true
            readings[date][period][hold][rtId] = { [SINGLE_POINT_ID]: val }
          } else {
            readings[date][period][hold][rtId] = { ...(val as Record<string, string>) }
          }
        }
      }
    }
  }

  return changed ? { ...v, readingTypes, readings } : v
}
