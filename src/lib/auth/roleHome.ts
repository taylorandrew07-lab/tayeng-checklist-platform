// Where each role lands, and which area each role owns. ONE definition, because
// this was five.
//
// Before this module the same four-line map was copy-pasted into src/app/page.tsx,
// the login page, the reset-password page, the auth callback route and the
// dashboard layout — under two different names (ROLE_HOME and ROLE_REDIRECT). They
// all happened to agree, so nothing was visibly wrong; but changing where the app
// opens meant finding all five, and missing one would have meant the app opened in
// a different place depending on whether you signed in, reset your password or
// followed a confirmation email. Nothing would have errored.
//
// TWO CONCEPTS, deliberately separate — conflating them is what made the old map
// dangerous to edit:
//
//   ROLE_PREFIX  the AREA a role may browse. The dashboard layout's guard bounces
//                anyone outside their own prefix.
//   role home    the single page a role LANDS on. It lives INSIDE that prefix but
//                is not the same thing: admins own all of /admin yet open on
//                /admin/jobs.
//
// The old code used one map for both. Repointing it at /admin/jobs would therefore
// have made /admin/jobs the guard PREFIX too — and every other admin page
// (Finance, Clients, Templates, Settings, Vessels, Cargo, Cases) would have failed
// `pathname.startsWith(prefix)` and bounced straight back to Jobs. Admins would
// have been locked into a single page. Keep these two apart.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'

/** The area each role owns. This is a GUARD PREFIX, never a destination. */
export const ROLE_PREFIX: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
  office: '/office',
}

/** Used when the role is missing or unreadable. The dashboard layout re-routes if
 *  it turns out to be wrong, so this must never be /login — the session is valid,
 *  and /login would send an authenticated user straight back round the loop. */
export const FALLBACK_HOME = '/surveyor'

/** Homes that need no lookup. `office` is deliberately absent — see resolveRoleHome. */
const STATIC_HOME: Record<string, string> = {
  admin: '/admin/jobs',
  surveyor: '/surveyor',
  client: '/client',
}

/**
 * Where to send this user now that they're signed in.
 *
 * Office is the one role that cannot be answered from a lookup table. /office/jobs
 * is permission-gated (`jobs.monitor.view` / `jobs.detail.view`), and office
 * permissions are granted per user — so sending every office user there would open
 * the app on "An administrator needs to grant you job-monitoring permission" for
 * anyone who hasn't been granted it, on every single launch. They land on /office
 * instead. Costs one extra query, for office users only.
 */
export async function resolveRoleHome(
  supabase: SupabaseClient,
  role: string | null | undefined,
): Promise<string> {
  if (role === 'office') {
    const granted = await fetchMyOfficePermissions(supabase)
    const canSeeJobs =
      granted.has(OFFICE_PERMISSIONS.JOBS_MONITOR_VIEW) ||
      granted.has(OFFICE_PERMISSIONS.JOBS_DETAIL_VIEW)
    return canSeeJobs ? '/office/jobs' : '/office'
  }
  return STATIC_HOME[role ?? ''] ?? FALLBACK_HOME
}

/** The role homes as literal paths — for callers that need to TEST whether a path
 *  is a landing page rather than compute one (BackGuard's back-button root). The
 *  office pair is listed in full because either may be that user's home. */
export const HOME_ROUTES: string[] = [
  '/admin/jobs',
  '/surveyor',
  '/client',
  '/office',
  '/office/jobs',
]
