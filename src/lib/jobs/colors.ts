// Curated, adaptable colour palette for tagging jobs by client or job type.
// Entities store a palette KEY (e.g. 'teal') — never raw hex — so the look stays
// curated and can evolve centrally. Light tint bg + readable dark fg, matching the
// cargo colour aesthetic (src/lib/cargo/colors.ts). Add/edit options here only.

export interface JobColor { bg: string; fg: string }
export interface PaletteOption extends JobColor { key: string; label: string }

export const JOB_PALETTE: PaletteOption[] = [
  { key: 'slate',   label: 'Slate',   bg: '#f1f5f9', fg: '#334155' },
  { key: 'gray',    label: 'Gray',    bg: '#f3f4f6', fg: '#374151' },
  { key: 'rose',    label: 'Rose',    bg: '#ffe4e6', fg: '#9f1239' },
  { key: 'orange',  label: 'Orange',  bg: '#ffedd5', fg: '#9a3412' },
  { key: 'amber',   label: 'Amber',   bg: '#fef3c7', fg: '#92400e' },
  { key: 'yellow',  label: 'Yellow',  bg: '#fef9c3', fg: '#854d0e' },
  { key: 'emerald', label: 'Emerald', bg: '#d1fae5', fg: '#065f46' },
  { key: 'teal',    label: 'Teal',    bg: '#ccfbf1', fg: '#115e59' },
  { key: 'sky',     label: 'Sky',     bg: '#e0f2fe', fg: '#075985' },
  { key: 'indigo',  label: 'Indigo',  bg: '#e0e7ff', fg: '#3730a3' },
  { key: 'violet',  label: 'Violet',  bg: '#ede9fe', fg: '#5b21b6' },
  { key: 'pink',    label: 'Pink',    bg: '#fce7f3', fg: '#9d174d' },
]

const BY_KEY: Record<string, JobColor> = Object.fromEntries(JOB_PALETTE.map(o => [o.key, { bg: o.bg, fg: o.fg }]))

/** Neutral fallback used when a row's entity has no colour assigned. */
export const NEUTRAL_COLOR: JobColor = { bg: '#ffffff', fg: '#1e293b' }

/** Resolve a stored palette key to its colour, or null if unset/unknown. */
export function resolveColor(key: string | null | undefined): JobColor | null {
  if (!key) return null
  return BY_KEY[key] ?? null
}
