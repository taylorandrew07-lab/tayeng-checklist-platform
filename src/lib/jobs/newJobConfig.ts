// Shared job-form taxonomy + helpers. Was copy-pasted (and already diverging)
// across admin/jobs/new, surveyor/jobs/new and surveyor/jobs/[id]. One source now,
// imported by all three — migrations that touch this vocabulary (147 Loading/
// Discharging, 154 Cargo Survey merge) change it in exactly one place.

// Local yyyy-mm-dd (for the <input type=date> default — avoids the UTC off-by-one
// that toISOString() causes around midnight in Trinidad, UTC-4).
export function isoDateLocal(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

export function dmyFromISO(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

// Conditional Stage picker: the broad survey types carry a qualifier (jobs.job_stage).
// Other types show no picker. `placeholder` is only set where "Select {label}…" would
// read badly — Cargo Survey's label is two words joined by a slash (migration 147).
export const STAGE_OPTIONS: Record<string, { label: string; options: string[]; placeholder?: string }> = {
  'Draught Survey': { label: 'Stage', options: ['Initial', 'Interim', 'Final'] },
  'Cargo Survey': { label: 'Loading/Discharging', options: ['Loading', 'Discharging'], placeholder: 'Select loading or discharging…' },
  'Hire Survey': { label: 'Status', options: ['On-hire', 'Off-hire'] },
}

// Cargo Survey jobs carry a "what's the cargo?" question. The retired 'Cargo Loading' /
// 'Cargo Discharging' types (merged into Cargo Survey by mig 154) are kept in the set so
// any historic job of those names still shows the field.
export const CARGO_JOB_TYPES = new Set(['Cargo Survey', 'Cargo Loading', 'Cargo Discharging'])

// Common cargoes — a datalist of suggestions; the field stays free text.
export const CARGO_SUGGESTIONS = ['Methanol', 'Crude Oil', 'Gasoil / Diesel', 'Gasoline', 'Jet A-1 / Kerosene', 'Fuel Oil', 'LPG', 'Anhydrous Ammonia', 'Urea', 'DRI', 'Iron Ore', 'Coal']

// The ~44px phone tap target the job pages use (the .btn-* classes are 36px tall).
// Taller on mobile for the correct-a-mistake controls, compact on desktop.
export const TAP_BTN = 'py-2.5 text-base sm:py-2 sm:text-sm'
