// Yes/No-family answer options — ONE source for the survey form, the PDF and the
// template builder.
//
// The option LIST used to be hard-coded in FieldRenderer, so a template's `options`
// JSON could only ever RECOLOUR the fixed Yes/No/N-A set — adding a fourth entry did
// nothing. The Pre-Hire Inspection template (migration 170) needs "Not inspected",
// which is a different statement from N/A: N/A means the item does not apply to this
// vessel; Not inspected means it applies and was not seen. On a facts-only report that
// distinction is the whole point, so the list now comes from the template when it
// supplies a complete one.
//
// Backward compatible by construction, in two independent ways:
//   1. The LIST is only taken from the template when it has 2+ entries that ALL carry a
//      label. Migration 008 backfilled complete labelled sets, and the only hand-written
//      overrides (Brine item 6, the UHT pass/fail fields) are also complete labelled
//      sets — so every existing field resolves to exactly what it rendered before.
//      Anything empty or partial falls through to the defaults below.
//   2. The COLOUR is resolved per value against the template's entry regardless of
//      whether its list was used, so a partial colour-only override still applies.

import type { FieldOption } from '@/lib/types/database'

export type AnswerFamily = 'yes_no' | 'yes_no_na' | 'pass_fail'

const FAMILY = new Set<string>(['yes_no', 'yes_no_na', 'pass_fail'])

export function isAnswerFamily(fieldType: string | null | undefined): fieldType is AnswerFamily {
  return !!fieldType && FAMILY.has(fieldType)
}

const DEFAULT_OPTIONS: Record<AnswerFamily, FieldOption[]> = {
  pass_fail: [
    { value: 'pass', label: 'Pass', color: 'green' },
    { value: 'fail', label: 'Fail', color: 'red' },
  ],
  yes_no: [
    { value: 'yes', label: 'Yes', color: 'green' },
    { value: 'no', label: 'No', color: 'red' },
  ],
  yes_no_na: [
    { value: 'yes', label: 'Yes', color: 'green' },
    { value: 'no', label: 'No', color: 'red' },
    { value: 'na', label: 'N/A', color: 'gray' },
  ],
}

/** Colour used when neither the template nor the option itself names one. Covers the
 *  house vocabulary, so a template can add `ni` without restating that it is grey. */
const FALLBACK_COLORS: Record<string, string> = {
  yes: 'green',
  no: 'red',
  na: 'gray',
  // Amber, not grey: "not inspected" is an open item someone still has to close, which
  // is a different thing from N/A ("does not apply here"), and it should catch the eye
  // when the report is read.
  ni: 'amber',
  pass: 'green',
  fail: 'red',
}

export function getDefaultAnswerOptions(type: AnswerFamily): FieldOption[] {
  return DEFAULT_OPTIONS[type].map(o => ({ ...o }))
}

/**
 * The answer choices to render for a yes/no-family field, in order.
 * `options` is the template field's raw options JSON (may be null/empty/partial).
 */
export function resolveAnswerOptions(type: AnswerFamily, options: FieldOption[] | null | undefined): FieldOption[] {
  const supplied = (options ?? []).filter(o => o && typeof o.value === 'string' && o.value !== '')
  const isCompleteList = supplied.length >= 2 && supplied.every(o => !!o.label)
  const list = isCompleteList ? supplied : DEFAULT_OPTIONS[type]
  return list.map(o => ({
    ...o,
    // Prefer the template's colour for this value even when its list wasn't used, so a
    // partial colour-only override (e.g. "make No green on this one") still lands.
    color: (supplied.find(s => s.value === o.value)?.color ?? o.color ?? FALLBACK_COLORS[o.value] ?? 'gray') as FieldOption['color'],
  }))
}

/**
 * Colour key for a single stored answer value — used by the PDF, which renders one
 * answer rather than the whole list.
 */
export function answerColor(value: string, options: FieldOption[] | null | undefined): string {
  return (options ?? []).find(o => o?.value === value)?.color ?? FALLBACK_COLORS[value] ?? 'gray'
}

/**
 * Short badge text for a stored answer value. The PDF badge cell is fixed-width, so a
 * long label ("Not inspected") is shown by its option value ("NI") — templates should
 * therefore keep custom values short. Falls back to the uppercased value, which is what
 * the PDF printed before this module existed.
 */
export function answerBadgeText(value: string, options: FieldOption[] | null | undefined): string {
  if (!value) return '—'
  const label = (options ?? []).find(o => o?.value === value)?.label
  // Use the label only when it is as short as a badge allows; otherwise the value.
  if (label && label.length <= 4) return label.toUpperCase()
  return value.toUpperCase()
}
