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
 *   Ocean Sun + Collision + Gulf Rambler → Collision — M.T. Ocean Sun v. F.V. Gulf Rambler
 *   Ocean Sun + Collision                → Collision — M.T. Ocean Sun
 *   Ocean Sun + Gulf Rambler             → M.T. Ocean Sun v. F.V. Gulf Rambler
 *   Collision + Gulf Rambler             → Collision — F.V. Gulf Rambler
 *
 * THE "v." SITS BETWEEN THE TWO PARTIES, and the type introduces them. Written the
 * other way round — "M.T. Ocean Sun — Collision v. F.V. Gulf Rambler" — it reads as
 * the collision being versus the Gulf Rambler, when what you want to see at a glance
 * is the two vessels against each other.
 *
 * "v." even when the other party is an injured person rather than an opposing vessel:
 * it is what the list, the case page and the claim PDF all print, and splitting the
 * convention here would make the same case read two ways.
 */
function derive(c: CaseNameParts): string {
  // withVesselPrefix defaults an absent type to M.V. — the app-wide behaviour — so
  // it is only called once there is actually a name to prefix.
  const vessel = (c.our_vessel ?? '').trim()
    ? withVesselPrefix(c.our_vessel, c.our_vessel_type as VesselPrefixInput)
    : ''
  const type = (c.case_type ?? '').trim()
  const other = (c.other_party ?? '').trim()

  // OURS FIRST, always — the case is read from our side of it.
  const parties = [vessel, other].filter(Boolean).join(' v. ')

  if (!type) return parties
  if (!parties) return type
  return `${type} — ${parties}`
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
