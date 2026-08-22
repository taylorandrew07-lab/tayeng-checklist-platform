// How a cargo voyage number is shown.
//
// Surveyors type these dockside and the shapes drifted: one voyage arrived as
// "V-047" and the next as plain "13", so the same field read two different ways
// across the fleet. VoyageSetupForm now normalises on entry, but voyages already
// recorded keep whatever was typed — and rewriting a document that is sitting on
// an offline device, mid-voyage, to tidy a label is not a trade worth making.
//
// So the canonical form is applied on the way OUT instead. Nothing is written,
// nobody's document changes, and "13" reads as "V-013" everywhere at once.
//
// The rule itself is normaliseVoyage() in lib/jobs/voyage.ts — the same one the
// draught-survey voyages use and a mirror of public.normalise_voyage (mig 186).
// It is deliberately lenient: anything that does not read as a plain number is
// returned exactly as typed, so "V-2026-014" and "24/07" are left alone.

import { normaliseVoyage } from '@/lib/jobs/voyage'

/** The voyage number as it should be displayed. Never null — an absent number
 *  renders as an empty string so callers can concatenate safely. */
export function displayVoyageNumber(raw: string | null | undefined): string {
  return normaliseVoyage(raw) ?? (raw ?? '').trim()
}
