// Client + surveyor pick lists for voyage setup. Reuses the same Supabase tables
// as the checklist "New Job" flow (clients, surveyor_names). Fetched online and
// cached so voyage setup still offers dropdowns offline.

import { createClient } from '@/lib/supabase/client'
import { cachePickLists, getCachedPickLists } from './db'

export interface PickLists {
  clients: { id: string; name: string }[]
  surveyors: { name: string }[]
}

export async function loadPickLists(): Promise<PickLists> {
  try {
    const supabase = createClient()
    const [{ data: cls, error: cErr }, { data: srv, error: sErr }] = await Promise.all([
      supabase.from('clients').select('id, name').eq('is_active', true).order('name'),
      supabase.from('surveyor_names').select('name').eq('is_active', true).order('name'),
    ])
    if (cErr || sErr) throw cErr || sErr
    const clients = (cls ?? []).map(c => ({ id: c.id as string, name: c.name as string }))
    const surveyors = (srv ?? []).map(s => ({ name: s.name as string }))
    await cachePickLists(clients, surveyors).catch(() => {})
    return { clients, surveyors }
  } catch {
    return await getCachedPickLists().catch(() => ({ clients: [], surveyors: [] }))
  }
}
