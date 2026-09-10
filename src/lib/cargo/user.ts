// Resolve the current staff user in an offline-safe way. Prefers whatever is
// already on the device — the persisted Supabase session, then the profile cached
// by the dashboard layout — because a cargo voyage is opened dockside, where a
// round trip to the database is the thing least likely to work.

import { createClient } from '@/lib/supabase/client'

export async function currentUserId(): Promise<string | null> {
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user?.id) return session.user.id
  } catch {
    /* offline / storage unavailable — try the cached profile */
  }
  try {
    const cached = localStorage.getItem('te_profile')
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.id) return parsed.id as string
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * The signed-in user's own name, for pre-filling the voyage surveyor.
 *
 * The CACHE leads here, unlike currentUserId() above: the auth session carries an
 * id but no full_name, so the only local copy of the name is the profile the
 * dashboard layout writes on every load. Asking the database first would mean a
 * network round trip on a form that routinely opens with no signal.
 *
 * Returns '' rather than throwing when it cannot tell. An unknown name is a
 * dropdown the surveyor picks from, which is exactly what it was before.
 */
export async function currentUserName(): Promise<string> {
  try {
    const cached = localStorage.getItem('te_profile')
    if (cached) {
      const name = String(JSON.parse(cached)?.full_name ?? '').trim()
      if (name) return name
    }
  } catch {
    /* storage unavailable — fall through to the database */
  }
  try {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user?.id) return ''
    // Reading your OWN row, which the mig-002 "Users can view own profile"
    // policy allows for every role.
    const { data } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single()
    return String(data?.full_name ?? '').trim()
  } catch {
    return ''
  }
}
