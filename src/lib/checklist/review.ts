// Reviewing a finished checklist: what was left blank, and what reads as a finding.
//
// Both questions were already being answered, in two different places and two different
// ways — the findings walk lived inside the PDF renderer (JobPDF's deficiency summary,
// migration 182) and the blank-field walk lived inside the editor's submit validation.
// The surveyor now needs both ON SCREEN before leaving the vessel, which would have made
// four implementations of two rules. This is the one module all of them call.
//
// The finding rule is the ANSWER COLOUR, never the word "No". Some questions are
// deliberately reversed — outstanding conditions of class, overdue maintenance, PSC
// deficiencies, breakdowns — where YES is the problem and No is green. Listing every
// "No" would report those backwards AND miss the real finding. Red and amber are both
// findings; green is not; grey is N/A. N/I resolves to amber on purpose: an item nobody
// could inspect is an open question, not a pass.
//
// Surface-agnostic by design. Instances, photos, visibility and label resolution differ
// between the editor (React state, conditional logic, queued photos) and the report
// (server rows, react-pdf), so each supplies its own small adapter rather than this
// module importing either world.

import { answerColor, answerBadgeText, isAnswerFamily } from './answerOptions'
import type { FieldOption } from '@/lib/types/database'
import { instanceKey } from '@/lib/offline/instanceKeys'

/** Field types that hold no answer and can never be "unanswered". */
const NON_ANSWER_TYPES = ['heading', 'divider', 'calculated']

export interface ReviewField {
  id: string
  label: string
  field_type: string
  item_number?: string | null
  is_required?: boolean
  options?: FieldOption[] | null
}

export interface ReviewSection {
  id: string
  is_repeatable?: boolean
  fields: ReviewField[]
}

export interface ReviewItem {
  fieldId: string
  instance: number
  /** instanceKey(fieldId, instance) — also the editor's DOM anchor, so a list row can
   *  scroll straight to the question it is complaining about. */
  key: string
  itemNumber: string | null
  label: string
  /** Findings only: the short badge text of the answer given ("No", "N/I"). */
  answer?: string
  /** Findings only: the surveyor's remark, the half after "|||". */
  remark?: string
  /** Findings only. Amber is a weaker finding than red but still a finding. */
  severity?: 'red' | 'amber'
}

export interface ReviewOptions {
  sections: ReviewSection[]
  values: Record<string, string>
  arrayValues: Record<string, string[]>
  signatures: Record<string, string>
  /** Which repeatable entries exist for this section. Non-repeatable sections get [0]. */
  instancesFor(section: ReviewSection): number[]
  /** Does this field/entry already hold at least one photo or attachment? */
  hasPhoto(fieldId: string, instance: number): boolean
  /** Is this question currently shown? A question the form is deliberately hiding has
   *  not been "left unanswered" — omitting this defaults everything to visible, which
   *  is what the report wants (hidden answers were cleared before it ever ran). */
  isVisible?(section: ReviewSection, field: ReviewField, instance: number): boolean
  /** Resolve {uuid} placeholders in a label. Defaults to the label as written. */
  resolveLabel?(label: string): string
  /** Restrict the unanswered list to required questions. Findings ignore this — a
   *  finding is a finding whether or not anyone was obliged to answer. */
  requiredOnly?: boolean
}

export interface ReviewResult {
  /** Questions with no answer, in checklist order. */
  unanswered: ReviewItem[]
  /** Answers that read red or amber, in checklist order. This IS the defect list. */
  findings: ReviewItem[]
}

/** The answer half of a "answer|||remarks" value. */
function answerPart(raw: string): string {
  return raw.includes('|||') ? raw.split('|||')[0] : raw
}

/** The remarks half, if the surveyor wrote one. */
function remarkPart(raw: string): string {
  return raw.includes('|||') ? raw.split('|||').slice(1).join('|||') : ''
}

/**
 * Is this field/entry empty? Mirrors the editor's submit validation exactly, because a
 * question this reports as answered must be one the submit check also accepts —
 * otherwise the panel says "all done" and the submit button then refuses.
 */
function isBlank(
  field: ReviewField,
  key: string,
  o: Pick<ReviewOptions, 'values' | 'arrayValues' | 'signatures' | 'hasPhoto'>,
  instance: number,
): boolean {
  switch (field.field_type) {
    case 'signature':
      return !o.signatures[key]
    case 'multiple_choice':
    case 'video_link':
      return !(o.arrayValues[key]?.length)
    case 'photo':
      // A photo taken with no signal has been taken; the adapter counts queued ones.
      return !o.hasPhoto(field.id, instance)
    default:
      // yes_no / pass_fail store "answer|||remarks". Validate the ANSWER half, so a
      // question carrying only a remark still counts as unanswered.
      return !answerPart(o.values[key] ?? '').trim()
  }
}

/**
 * Walk a checklist once and report both what is blank and what reads as a finding.
 * Pure: no React, no Supabase, no react-pdf. Order is checklist order — section by
 * section, entry by entry, field by field — so a list reads top-to-bottom like the form.
 */
export function reviewChecklist(o: ReviewOptions): ReviewResult {
  const unanswered: ReviewItem[] = []
  const findings: ReviewItem[] = []
  const label = o.resolveLabel ?? ((l: string) => l)

  for (const section of o.sections) {
    const instances = section.is_repeatable ? o.instancesFor(section) : [0]
    for (const instance of instances) {
      for (const field of section.fields ?? []) {
        if (NON_ANSWER_TYPES.includes(field.field_type)) continue
        if (o.isVisible && !o.isVisible(section, field, instance)) continue

        const key = instanceKey(field.id, instance)
        const base = {
          fieldId: field.id,
          instance,
          key,
          itemNumber: field.item_number ?? null,
          label: label(field.label),
        }

        if (isBlank(field, key, o, instance)) {
          if (!o.requiredOnly || field.is_required) unanswered.push(base)
          // A blank question cannot also be a finding.
          continue
        }

        if (!isAnswerFamily(field.field_type)) continue
        const raw = o.values[key] ?? ''
        const value = answerPart(raw)
        if (!value) continue
        const colour = answerColor(value, field.options)
        if (colour !== 'red' && colour !== 'amber') continue
        findings.push({
          ...base,
          answer: answerBadgeText(value, field.options),
          remark: remarkPart(raw),
          severity: colour === 'amber' ? 'amber' : 'red',
        })
      }
    }
  }

  return { unanswered, findings }
}
