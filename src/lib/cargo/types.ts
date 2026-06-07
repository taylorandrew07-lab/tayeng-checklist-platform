// Cargo Hold Monitoring — local-first data shapes stored in IndexedDB.
// Everything here is browser-local (the slice has no Supabase tables yet); cloud
// sync is a later phase. All records are scoped by `userId` so two staff users on
// one device never see each other's voyages.

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

/** A configurable reading (temperature/gas/custom). New types need no code change. */
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
}

/** Per date+period operational metadata (actual time the round was walked, notes). */
export interface PeriodMeta {
  actualTime?: string
  remarks?: string
  /** Set once the surveyor has reviewed and confirmed this period's photo set. */
  photosConfirmed?: boolean
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

/**
 * One voyage report. Readings are kept inline as a nested map keyed by
 * date → period → holdNumber → readingTypeId so the whole report loads/saves as a
 * single IndexedDB document. Photos live in a separate store (blobs).
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
  clientName?: string
  remarks?: string

  // --- Config ---
  readingTypes: ReadingType[]

  // --- Data ---
  /** readings[dateISO][period][holdNumber][readingTypeId] = entered value */
  readings: Record<string, Record<string, Record<string, Record<string, string>>>>
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
}

export const HOLD_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const
export const DEFAULT_HOLD_COUNT = 5

/** Default reading set seeded into every new voyage; fully editable afterwards. */
export function defaultReadingTypes(): ReadingType[] {
  const base: Array<Omit<ReadingType, 'id'>> = [
    { name: 'Thermocouple Temperature', unit: '°C', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true },
    { name: 'Infrared Temperature', unit: '°C', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true },
    { name: 'Oxygen', unit: '%', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true },
    { name: 'Carbon Monoxide', unit: 'ppm', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true },
    { name: 'Hydrogen', unit: 'ppm', appliesTo: 'all', includeInTables: true, includeInCharts: true, includeInPdf: true, builtIn: true },
  ]
  return base.map((r, i) => ({ ...r, id: `rt_${i}_${r.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}` }))
}

/** Whether a reading type collects a value for a given hold. */
export function readingTypeAppliesToHold(rt: ReadingType, holdNumber: number): boolean {
  return rt.appliesTo === 'all' || rt.appliesTo.includes(holdNumber)
}

/**
 * Deep-copy reading types for a voyage snapshot so it never aliases the source
 * template's array (later template edits must not mutate existing voyages).
 */
export function cloneReadingTypes(types: ReadingType[]): ReadingType[] {
  return types.map(rt => ({ ...rt, appliesTo: rt.appliesTo === 'all' ? 'all' : [...rt.appliesTo] }))
}
