/**
 * Clearing answers that conditional logic has hidden.
 *
 * Hidden fields were historically left alone: FieldRenderer simply returns null for them, and
 * handleSave re-upserts whatever is in `values`. So an answer given while a field was visible
 * survived after its parent changed and the field disappeared — invisible to the surveyor, but
 * still read by every conditional that references it, and still printed by the PDF route.
 *
 * The Brine Transfer template made this reachable in a way that corrupts a signed report: item 22
 * ("have the charterers been notified the cargo is off-spec?") is shown when any of 20A/21A/24A/25A
 * is No. Answer 20 = Yes then 20A = No, then correct 20 to No — 20A hides, its stored "no" remains,
 * and item 22 stays on the checklist and in the PDF for a job that had no off-spec finding.
 *
 * IMPORTANT: only ever run this in response to a USER EDIT, never during load. On a fresh page
 * every value starts empty, so every conditional evaluates false and every dependent field looks
 * hidden — clearing then would wipe a whole completed checklist.
 */

import { checkConditionalLogic } from '@/lib/utils'
import type { ConditionalLogic } from '@/lib/types/database'

/** One addressable answer slot: a field within a section, at a given repeatable instance. */
export interface VisibilityUnit {
  /** The composite key this answer is stored under in the values map. */
  key: string
  /** The field's own visibility rule. */
  logic: ConditionalLogic | null
  /** The containing section's visibility rule, if any. */
  sectionLogic?: ConditionalLogic | null
}

/**
 * Blank out any answer whose field is currently hidden.
 *
 * Iterates to a fixed point, because clearing one answer can hide another that depended on it
 * (e.g. 6 → 6A → 6B). Capped so a pathological/cyclic template cannot spin.
 *
 * Returns a NEW map when something changed, or null when nothing did — so callers can skip a
 * needless re-render and avoid marking a pristine checklist dirty.
 */
export function clearHiddenAnswers(
  units: VisibilityUnit[],
  values: Record<string, string>,
  maxPasses = 5,
): Record<string, string> | null {
  let next = values
  let changed = false

  for (let pass = 0; pass < maxPasses; pass++) {
    let passChanged = false

    for (const unit of units) {
      // Only non-empty answers are worth clearing; '' is already the unanswered state.
      if (!next[unit.key]) continue

      const visible =
        checkConditionalLogic(unit.sectionLogic ?? null, next) &&
        checkConditionalLogic(unit.logic ?? null, next)
      if (visible) continue

      if (!passChanged) next = { ...next }
      next[unit.key] = ''
      passChanged = true
    }

    if (!passChanged) break
    changed = true
  }

  return changed ? next : null
}
