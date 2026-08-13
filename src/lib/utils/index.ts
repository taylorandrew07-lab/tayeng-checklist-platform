import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, parseISO } from 'date-fns'
import { instanceKey } from '@/lib/offline/instanceKeys'
import type { FieldType } from '@/lib/types/database'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy')
  } catch {
    return dateStr
  }
}

/** A sortable local-calendar-day key ('yyyy-MM-dd') for a date OR timestamp, matching
 * exactly what formatDate() displays. Sorting a job list by the raw value is wrong:
 * a pure DATE (e.g. scheduled_date '2026-06-22') and a UTC TIMESTAMP (e.g. created_at
 * '2026-06-21T02:00:00Z') don't compare correctly as strings — a late-night-UTC
 * timestamp shows as the previous local day but its raw string sorts as the next day,
 * and a date-only string sorts before any same-day timestamp. Normalising both to the
 * local calendar day makes the sort order match the visible dates. */
export function dayKey(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    return format(parseISO(dateStr), 'yyyy-MM-dd')
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'dd MMM yyyy HH:mm')
  } catch {
    return dateStr
  }
}

/**
 * Returns the canonical vessel-type prefix a text field's value should carry,
 * based on its label, or null if the field is not a vessel-name field.
 *  - "Bunker Vessel Name" (a tanker) → "M.T." (Motor Tanker)
 *  - the surveyed vessel (e.g. "Vessel", "Vessel Name") → "M.V." (Motor Vessel)
 * Mirrors the vessel/bunker matching used for metadata auto-fill so the same
 * fields are affected.
 */
/**
 * A vessel's class, stored as the literal prefix it renders as:
 *  - 'M.V.' — Motor Vessel (the default for everything)
 *  - 'M.T.' — Motor Tanker
 * Stored on vessels.vessel_type / jobs.vessel_type / cargo_voyages.vessel_type.
 * Kept as the rendered literal rather than a separate 'vessel'|'tanker' vocabulary
 * so a display call site is `withVesselPrefix(name, row.vessel_type)` with no mapper.
 */
export type VesselPrefix = 'M.V.' | 'M.T.'

/** Anything that can name a prefix: a stored VesselPrefix, or nothing.
 *  null/undefined ⇒ 'M.V.', so any surface that does not yet know the type keeps
 *  today's behaviour exactly. */
export type VesselPrefixInput = VesselPrefix | null | undefined

/**
 * THE seam that turns a stored vessel type into the prefix the UI/PDF prints.
 * Everything that currently hardcodes an 'M.V.' literal should call this instead.
 * Unknown/absent ⇒ 'M.V.'.
 *
 * NOTE: deliberately NOT used to resolve a checklist field's prefix — see
 * vesselPrefixForLabel, whose `null` means "not a vessel-name field at all" and
 * must be tested BEFORE anything defaults it to 'M.V.'.
 */
export function prefixForVesselType(input: VesselPrefixInput): VesselPrefix {
  return input === 'M.T.' ? 'M.T.' : 'M.V.'
}

// Descriptor fields that contain "vessel" but are NOT the vessel name, so must
// not receive an M.V./M.T. prefix (e.g. "Vessel Type", "Vessel IMO Number").
const NON_NAME_VESSEL_QUALIFIERS = [
  'type', 'imo', 'flag', 'owner', 'call sign', 'callsign', 'grt', 'nrt', 'dwt',
  'length', 'beam', 'draft', 'draught', 'year', 'built', 'class', 'port',
  'registry', 'number', 'no.', 'gross', 'net', 'tonnage', 'loa',
]

export function vesselPrefixForLabel(label: string): VesselPrefix | null {
  const l = label.toLowerCase()
  if (!l.includes('vessel')) return null
  // Only the vessel *name* fields are prefixed — skip descriptor fields.
  if (NON_NAME_VESSEL_QUALIFIERS.some(q => l.includes(q))) return null
  if (l.includes('bunker')) return 'M.T.'
  return 'M.V.'
}

/**
 * True when a field's label denotes the SURVEYED vessel's name field — the one
 * that should be auto-filled with the job's vessel_name and shown as "the
 * vessel" in the PDF. Built on vesselPrefixForLabel so descriptor fields
 * ("Vessel IMO Number", "Vessel Type", …) and the separate bunker vessel are
 * excluded. Use this instead of an ad-hoc `label.includes('vessel')` check.
 */
export function isSurveyedVesselNameField(label: string): boolean {
  return vesselPrefixForLabel(label) === 'M.V.'
}

/**
 * Normalises a vessel name to "<prefix> Title Cased Name":
 *  - strips any existing prefix the user typed (so we never double up, e.g.
 *    "M.T. M.T. Test" → "M.T. Test"), matching forms like "MT", "M.T.", "M T"
 *  - title-cases the remaining words ("TEST VESSEL" → "Test Vessel")
 *  - re-applies the canonical prefix
 * Returns '' for empty input (and never returns a bare prefix on its own).
 */
// NOTE: `prefix` is deliberately NON-nullable. vesselPrefixForLabel returns null to
// mean "not a vessel-name field", and every caller tests that null first; accepting
// null here would make those guards optional and silently stamp "M.V." onto ordinary
// text answers (a "Port / Location" of "point lisas" → "M.V. Point Lisas").
export function normalizeVesselName(raw: string, prefix: VesselPrefix): string {
  const titled = titleCaseVesselName(raw)
  return titled ? `${prefix} ${titled}` : ''
}

/**
 * Canonical BARE vessel name (no prefix) for storage + display wherever a vessel
 * name appears without an explicit prefix (job list, jobs.vessel_name, the vessels
 * directory, cargo voyages). Standardises however a surveyor typed it:
 *  - strips a leading M.V./M.T./MV/MT prefix (dots/spaces optional, repeatable) so
 *    the stored name stays bare and the UI re-adds the canonical prefix
 *  - Title-Cases each word: "DELTA TITAN" → "Delta Titan", "delta emperor" →
 *    "Delta Emperor", "Bonnie D" → "Bonnie D" (single letters stay capitalised),
 *    "o'brien" → "O'Brien", "delta-titan" → "Delta-Titan"
 * Returns '' for empty / prefix-only input.
 */
// The separator between the M and the V/T may be a dot, whitespace or a SLASH, so
// "M.T." / "MT" / "M T" / "M/T" are all recognised. The trailing [\s.]+ is the
// safety property that keeps real words intact: it requires a separator AFTER the
// V/T, which is why "Mtoto" and "Mvuli" are never eaten (and why "M/TAlpha" is not
// stripped either — the same rule "MTAlpha" already obeyed).
const VESSEL_PREFIX_RUN = /^(?:m[.\s/]*[vt]\.?[\s.]+)+/i
// Single leading token, capturing V or T, for detecting which prefix was typed.
const VESSEL_PREFIX_TOKEN = /^m[.\s/]*([vt])\.?[\s.]+/i

/**
 * Splits however a user typed a vessel name into the prefix they intended and the
 * canonical bare name. This is what makes typing "M.T. Lila Montreal" / "MT Lila
 * Montreal" / "M/T Lila Montreal" mark the vessel as a Motor Tanker.
 *  - `prefix` is null when no prefix was typed, so the caller can fall back to the
 *    vessel's stored type rather than defaulting to M.V. over the top of it.
 *  - `name` is the bare Title-Cased name (what actually gets stored).
 * Only the FIRST token decides the type; a doubled "M.V. M.T. Foo" is still fully
 * stripped by titleCaseVesselName, and reports M.V. (what the user typed first).
 */
export function parseVesselName(raw: string | null | undefined): {
  prefix: VesselPrefix | null
  name: string
} {
  if (!raw) return { prefix: null, name: '' }
  const m = VESSEL_PREFIX_TOKEN.exec(raw.trim())
  const prefix: VesselPrefix | null = m
    ? (m[1].toLowerCase() === 't' ? 'M.T.' : 'M.V.')
    : null
  return { prefix, name: titleCaseVesselName(raw) }
}

export function titleCaseVesselName(raw: string): string {
  if (!raw) return ''
  let v = raw.trim()
  if (!v) return ''
  // Strip leading M.V./M.T. prefix tokens (dots/spaces/slashes optional, repeatable),
  // each followed by a separator so real words like "Mtoto"/"Mvuli" are left intact.
  v = v.replace(VESSEL_PREFIX_RUN, '').trim()
  if (!v) return ''
  return v.toLowerCase().replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1))
}

/** Human-readable byte size ('—' for null/0/undefined). */
export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}

/** Sanitise a filename for use as a storage object key (keeps the allowlist of
 *  alphanumerics, dot, underscore, hyphen; everything else → '_'). */
export function sanitizeStorageName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Vessel name with exactly one canonical prefix for display, e.g.
 * "M.V. Delta Titan" / "M.T. Bunker One". Reuses titleCaseVesselName (which
 * strips any existing M.V./M.T. prefix the user typed and Title-Cases the rest),
 * then re-applies the requested prefix. Returns '' for empty / prefix-only input.
 */
export function withVesselPrefix(
  name: string | null | undefined,
  prefix: VesselPrefixInput = 'M.V.',
): string {
  if (!name) return ''
  const titled = titleCaseVesselName(name)
  return titled ? `${prefixForVesselType(prefix)} ${titled}` : ''
}

// A voyage token a surveyor typed INTO a vessel name — "Chaconia (V086)". Anchored to
// a parenthetical at the END containing only a V-token and digits, so "(Final)",
// "(Hull 4)" and "Ocean Star 7" never match. Same pattern as migration 186's backfill.
const VOYAGE_IN_NAME = /\s*\(\s*([Vv][-._ ]?[0-9]+)\s*\)\s*$/

/**
 * Split a typed vessel name into the bare name and any voyage reference smuggled into
 * it. This is the guard that stops "Chaconia (V086)" being stored as a vessel again —
 * and stops findOrCreateVessel creating a new vessel row per voyage.
 *
 * Returns the voyage EXACTLY as typed; canonicalising it to V-### is
 * normaliseVoyage's job (lib/jobs/voyage.ts), which owns every voyage rule. Kept here
 * rather than there so the vessel-name seam has no dependency on the billing seam.
 */
export function splitVoyageFromVesselName(raw: string | null | undefined): {
  name: string
  voyage: string | null
} {
  if (!raw) return { name: '', voyage: null }
  const m = VOYAGE_IN_NAME.exec(raw)
  if (!m) return { name: raw, voyage: null }
  return { name: raw.replace(VOYAGE_IN_NAME, '').trim(), voyage: m[1] }
}

/**
 * Vessel name for display with its voyage alongside — "Chaconia (V-086)".
 *
 * The voyage is rendered NEXT TO the name, never inside the stored one. The jobs grid
 * shows it as its own muted sub-line instead (matching the cargo row's existing
 * voyageCell); this single-string form is for the places that only have room for one
 * line: dashboards, CSV exports, PDF headers, search results.
 */
export function vesselWithVoyage(
  name: string | null | undefined,
  prefix: VesselPrefixInput,
  voyage: string | null | undefined,
): string {
  const base = withVesselPrefix(name, prefix)
  if (!base) return ''
  const v = (voyage ?? '').trim()
  return v ? `${base} (${v})` : base
}

export function getFieldTypeLabel(type: FieldType): string {
  const labels: Record<FieldType, string> = {
    text: 'Text',
    number: 'Number',
    date: 'Date',
    time: 'Time',
    dropdown: 'Dropdown',
    yes_no: 'Yes / No',
    yes_no_na: 'Yes / No / N/A',
    pass_fail: 'Pass / Fail',
    multiple_choice: 'Multiple Choice',
    textarea: 'Long Text / Remarks',
    calculated: 'Calculated',
    photo: 'Photo Upload',
    video_link: 'Video Link',
    client_select: 'Client (linked)',
    signature: 'Signature',
    heading: 'Section Heading',
    divider: 'Divider',
  }
  return labels[type] ?? type
}

/**
 * Numeric value of a checklist field for a calculation. A `time` field holds
 * "HH:MM" — convert it to decimal hours so a formula like
 * `{arriveBase} - {departBase}` yields elapsed hours (17:30 − 08:00 = 9.5).
 * Everything else parses as a plain number (NaN for non-numeric).
 */
function fieldNumericValue(value: string): number {
  const t = /^(\d{1,2}):([0-5]\d)$/.exec(value.trim())
  if (t) return Number(t[1]) + Number(t[2]) / 60
  return parseFloat(value)
}

export function evaluateCalculation(
  formula: string,
  values: Record<string, string>,
  instance = 0
): string {
  try {
    // Resolve each {fieldId} token against THIS repeatable-entry instance, so a calc
    // in entry 2 uses entry 2's inputs — not entry 1's. instanceKey(id, 0) is the bare
    // id, so the common (non-repeatable) path is byte-identical to before. An absent
    // token leaves the formula unresolvable → '' (same as the old behaviour); a
    // present-but-non-numeric value counts as 0.
    let unresolved = false
    const expr = formula.replace(/\{([^}]+)\}/g, (_m, rawId: string) => {
      const key = instanceKey(rawId.trim(), instance)
      if (!(key in values)) { unresolved = true; return '0' }
      const num = fieldNumericValue(values[key])
      return isNaN(num) ? '0' : String(num)
    })
    if (unresolved) return ''
    // Only allow safe math expressions
    if (!/^[\d\s+\-*/().]+$/.test(expr)) return ''
    // Evaluate WITHOUT eval()/Function(): those need CSP 'unsafe-eval', which we
    // (correctly) don't allow, so they throw in the browser and the result silently
    // came back empty. This safe arithmetic parser keeps the CSP locked down.
    const result = evalArithmetic(expr)
    return result !== null && isFinite(result) ? String(Math.round(result * 10000) / 10000) : ''
  } catch {
    return ''
  }
}

/**
 * Evaluate a basic arithmetic expression (numbers, + - * /, parentheses, unary
 * +/-) without eval()/Function — so it works under a CSP that forbids
 * 'unsafe-eval'. Returns null on any malformed input.
 */
export function evalArithmetic(input: string): number | null {
  const matched = input.match(/\d+\.?\d*|\.\d+|[+\-*/()]/g)
  if (!matched) return null
  const tokens: string[] = matched
  let pos = 0
  const peek = (): string | undefined => tokens[pos]

  function parseExpr(): number | null {
    let v = parseTerm()
    if (v === null) return null
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++]
      const r = parseTerm()
      if (r === null) return null
      v = op === '+' ? v + r : v - r
    }
    return v
  }
  function parseTerm(): number | null {
    let v = parseFactor()
    if (v === null) return null
    while (peek() === '*' || peek() === '/') {
      const op = tokens[pos++]
      const r = parseFactor()
      if (r === null) return null
      v = op === '*' ? v * r : v / r
    }
    return v
  }
  function parseFactor(): number | null {
    const t = peek()
    if (t === '+') { pos++; return parseFactor() }
    if (t === '-') { pos++; const f = parseFactor(); return f === null ? null : -f }
    if (t === '(') {
      pos++
      const v = parseExpr()
      if (peek() !== ')') return null
      pos++
      return v
    }
    if (t !== undefined && /^(?:\d+\.?\d*|\.\d+)$/.test(t)) { pos++; return parseFloat(t) }
    return null
  }

  const result = parseExpr()
  // Reject leftover tokens (malformed input like "1 2" or "(1+2").
  if (result === null || pos !== tokens.length) return null
  return result
}

/**
 * Formats a volume difference + true percentage for display in the "Difference" calculated field.
 * Returns null pct when denominator is zero/missing (safe no-divide guard).
 *
 * `unit` defaults to 'USG' so every pre-existing caller (the BPTT Fuel Transfer template, whose
 * figures ARE in US gallons) keeps byte-identical output. Templates measured in other units — e.g.
 * Brine Transfer in BBLS — set `unit` on the calculated field and get their own label.
 */
export function formatDiffPercentage(
  rawDiff: number,
  denominatorStr: string | undefined,
  unit: string = 'USG'
): { display: string; pct: number | null } {
  const denominator = parseFloat(denominatorStr ?? '')
  if (!isFinite(denominator) || denominator === 0) {
    return { display: '—', pct: null }
  }
  const pct = (rawDiff / denominator) * 100
  const diffDisplay = Number.isInteger(rawDiff) ? String(rawDiff) : rawDiff.toFixed(2)
  return { display: `${diffDisplay} ${unit}: ${pct.toFixed(2)}%`, pct }
}

export function checkConditionalLogic(
  logic: { operator: 'and' | 'or'; conditions: Array<{ field_id: string; operator: string; value: string }> } | null,
  values: Record<string, string>
): boolean {
  if (!logic || !logic.conditions?.length) return true

  const results = logic.conditions.map((condition) => {
    // Strip |||remarks suffix from yes_no/yes_no_na values before comparing
    const raw = values[condition.field_id] ?? ''
    const fieldValue = raw.includes('|||') ? raw.split('|||')[0] : raw
    switch (condition.operator) {
      case 'equals': return fieldValue === condition.value
      case 'not_equals': return fieldValue !== condition.value
      case 'contains': return fieldValue.includes(condition.value)
      case 'greater_than': return parseFloat(fieldValue) > parseFloat(condition.value)
      case 'less_than': return parseFloat(fieldValue) < parseFloat(condition.value)
      case 'is_empty': return !fieldValue
      case 'is_not_empty': return !!fieldValue
      default: return true
    }
  })

  return logic.operator === 'and'
    ? results.every(Boolean)
    : results.some(Boolean)
}

/**
 * Races a promise against a timeout. Rejects with a user-visible message if
 * the timeout fires first. The underlying request is still in-flight but the
 * UI is unblocked.
 */
export function withTimeout<T>(thenable: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(
      () => reject(new Error(`${label} timed out — check your connection and try again.`)),
      ms
    )
  })
  return Promise.race([Promise.resolve(thenable), timeout]).finally(() => {
    if (timerId !== undefined) clearTimeout(timerId)
  })
}
