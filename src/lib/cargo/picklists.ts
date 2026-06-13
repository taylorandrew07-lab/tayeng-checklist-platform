// Client pick list for voyage setup (cached so setup still offers the dropdown
// offline). The voyage surveyor is free-text now — the legacy surveyor_names
// registry was retired, and surveyors can't list other accounts under RLS.

import { createClient } from '@/lib/supabase/client'
import { cachePickLists, getCachedPickLists } from './db'

export interface PickLists {
  clients: { id: string; name: string }[]
  surveyors: { name: string }[]
}

export async function loadPickLists(): Promise<PickLists> {
  try {
    const supabase = createClient()
    const { data: cls, error: cErr } = await supabase.from('clients').select('id, name').eq('is_active', true).order('name')
    if (cErr) throw cErr
    const clients = (cls ?? []).map(c => ({ id: c.id as string, name: c.name as string }))
    const surveyors: { name: string }[] = []
    await cachePickLists(clients, surveyors).catch(() => {})
    return { clients, surveyors }
  } catch {
    const cached = await getCachedPickLists().catch(() => ({ clients: [], surveyors: [] }))
    // Ignore any legacy cached surveyor names — the field is free-text now.
    return { clients: cached.clients, surveyors: [] }
  }
}
