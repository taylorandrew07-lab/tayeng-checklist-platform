import { createClient } from '@/lib/supabase/client'
import type { UiPrefs } from '@/lib/types/database'

// Account-based UI preferences, stored as a JSONB blob on the user's own profile
// row (profiles.ui_prefs). Because they live server-side, a choice made on one
// device (e.g. which Jobs columns to show) follows the user to every other device,
// unlike localStorage which is per-browser. RLS already lets a user read/update
// their own profile's non-sensitive columns (migrations 004 + 024).

/** Read the signed-in user's ui_prefs blob. Returns {} when signed out / offline. */
export async function getUiPrefs(): Promise<UiPrefs> {
  const supabase = createClient()
  // getSession() reads the persisted session without a network round-trip; good
  // enough to identify the row, and won't stall offline.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return {}
  const { data } = await supabase.from('profiles').select('ui_prefs').eq('id', session.user.id).single()
  return (data?.ui_prefs as UiPrefs) ?? {}
}

/**
 * Merge one key into the user's ui_prefs and persist it. Read-merge-write so the
 * other keys (nav_order, dashboard_tiles, …) are preserved. Best-effort: silently
 * no-ops when signed out or offline (the caller keeps a localStorage cache).
 */
export async function setUiPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): Promise<void> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return
  const { data } = await supabase.from('profiles').select('ui_prefs').eq('id', session.user.id).single()
  const current = (data?.ui_prefs as UiPrefs) ?? {}
  await supabase.from('profiles').update({ ui_prefs: { ...current, [key]: value } }).eq('id', session.user.id)
}
