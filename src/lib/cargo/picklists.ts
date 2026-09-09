// Client + surveyor pick lists for voyage setup (cached so setup still offers the
// dropdowns offline, which is where a cargo voyage is usually created).
//
// The surveyor list is the app's own people — the same active admin/surveyor
// profiles that every other job surface names — not a free-text box and not the
// retired `surveyor_names` registry. Surveyors CAN read those rows: the mig-002
// policy "Surveyors can view surveyor profiles" grants a surveyor SELECT on every
// active admin/surveyor profile, and mig 130 moved the genuine PII off the table
// precisely because that policy exists. If RLS ever narrows, the query returns
// nothing rather than failing, and the setup form falls back to free text.

import { createClient } from '@/lib/supabase/client'
import { cachePickLists, getCachedPickLists } from './db'

export interface PickLists {
  clients: { id: string; name: string }[]
  surveyors: { name: string }[]
}

export async function loadPickLists(): Promise<PickLists> {
  try {
    const supabase = createClient()
    const [{ data: cls, error: cErr }, { data: ppl }] = await Promise.all([
      supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
      supabase.from('profiles').select('full_name')
        .in('role', ['admin', 'surveyor']).eq('is_active', true).order('full_name'),
    ])
    // Only the client list is load-bearing enough to fall back to cache for.
    if (cErr) throw cErr
    const clients = (cls ?? []).map(c => ({ id: c.id as string, name: c.name as string }))
    const surveyors = Array.from(new Set(
      (ppl ?? []).map(p => ((p.full_name as string | null) ?? '').trim()).filter(Boolean)
    )).map(name => ({ name }))
    await cachePickLists(clients, surveyors).catch(() => {})
    return { clients, surveyors }
  } catch {
    return await getCachedPickLists().catch(() => ({ clients: [], surveyors: [] }))
  }
}
