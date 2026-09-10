// What a P&I case is CALLED. One function, because a case name now appears on the
// list, the case page, the claim PDF and the claim filename, and a name assembled
// four times is a name that reads four ways.
//
// The case had a typed `title` alongside vessel / type / other party, and the two
// always said the same thing: a matter typed as "Ocean Sun collision" sat above a
// row already holding Ocean Sun and Collision. So the parts ARE the name — nothing
// is typed, nothing can disagree, and correcting the vessel corrects the name
// everywhere at once.
//
// The stored title survives as a fallback ONLY. A case migrated off the job model
// (mig 213) has its name in `title` and NULL for every part, so deriving alone
// would leave it blank; mig 217 recovers what it can and this covers the rest.

import { withVesselPrefix, type VesselPrefixInput } from '@/lib/utils'

/** Structural, not `CaseRow`, so lib/cases/api.ts can import this without a cycle. */
export interface CaseNameParts {
  our_vessel?: string | null
  our_vessel_type?: string | null
  case_type?: string | null
  other_party?: string | null
  /** Legacy typed name. Read only when nothing can be derived. */
  title?: string | null
}

export const UNTITLED_CASE = 'Untitled case'

/**
 * The name built from the parts, or '' when there are none.
 *
 *   Ocean Sun + Collision + Atlantic Star → M.V. Ocean Sun — Collision v. Atlantic Star
 *   Ocean Sun + Collision                 → M.V. Ocean Sun — Collision
 *   Ocean Sun + Atlantic Star             → M.V. Ocean Sun v. Atlantic Star
 *   Collision + Atlantic Star             → Collision v. Atlantic Star
 *
 * "v." even when the other party is an injured person rather than an opposing
 * vessel: it is what the list, the case page and the claim PDF already print, and
 * splitting the convention here would make the same case read two ways.
 */
function derive(c: CaseNameParts): string {
  // withVesselPrefix defaults an absent type to M.V. — the app-wide behaviour — so
  // it is only called once there is actually a name to prefix.
  const vessel = (c.our_vessel ?? '').trim()
    ? withVesselPrefix(c.our_vessel, c.our_vessel_type as VesselPrefixInput)
    : ''
  const type = (c.case_type ?? '').trim()
  const other = (c.other_party ?? '').trim()
  const matter = [type, other ? `v. ${other}` : ''].filter(Boolean).join(' ')

  if (!vessel) return matter
  if (!matter) return vessel
  // An em dash introduces the matter, but "M.V. Ocean Sun — v. Atlantic Star"
  // reads as a typo, so with no type it becomes the plain "A v. B" case name.
  return type ? `${vessel} — ${matter}` : `${vessel} ${matter}`
}

/** THE name of a case. Never empty. */
export function caseTitle(c: CaseNameParts): string {
  return derive(c) || (c.title ?? '').trim() || UNTITLED_CASE
}

/** Whether the parts alone can name this case — what the New Case form requires
 *  now that there is no title box to fill in. */
export function isCaseNameable(c: CaseNameParts): boolean {
  return derive(c) !== ''
}
