import type { SupabaseClient } from '@supabase/supabase-js'
import type { OfficePermissionKey } from '@/lib/types/database'

/**
 * Office permission catalog keys, mirrored from migration 025's
 * office_permission_catalog seed. The database is the source of truth for
 * authorization (RLS + office_user_permissions); these constants are for
 * driving the office UI (which nav items / pages to show).
 */
export const OFFICE_PERMISSIONS = {
  JOBS_MONITOR_VIEW: 'jobs.monitor.view',
  JOBS_DETAIL_VIEW: 'jobs.detail.view',
  CLIENTS_VIEW: 'clients.view',
  INVOICING_VIEW: 'invoicing.view',
  INVOICING_MANAGE: 'invoicing.manage',
  PERSONAL_DOCS_VIEW: 'personal_docs.view',
  PERSONAL_DOCS_EXPIRY_NOTIFY: 'personal_docs.expiry.notify',
} as const satisfies Record<string, OfficePermissionKey>

/**
 * Fetch the set of permission keys the current office user is allowed.
 * Returns an empty set on any error or for non-office users (RLS denies the
 * read), so callers can treat "no access" as the safe default.
 *
 * UI gating only — never a substitute for the RLS policies that actually block
 * data access.
 */
export async function fetchMyOfficePermissions(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return new Set()

  const { data, error } = await supabase
    .from('office_user_permissions')
    .select('permission_key, allowed')
    .eq('profile_id', session.user.id)
    .eq('allowed', true)

  if (error || !data) return new Set()
  return new Set(data.map((r: { permission_key: string }) => r.permission_key))
}

/** Convenience: does this set grant any of the given keys? */
export function hasAnyOfficePermission(
  granted: Set<string>,
  ...keys: OfficePermissionKey[]
): boolean {
  return keys.some(k => granted.has(k))
}
