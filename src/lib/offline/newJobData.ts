// Data needed to START a new job from a template. Cached locally so a surveyor can
// begin a checklist with no signal. Only surveyor-startable active templates are
// included (RLS requires allow_surveyor_start to create the job on sync).

import { createClient } from '@/lib/supabase/client'
import { cacheNewJobData, getCachedNewJobData, type CachedNewJobData } from './db'

export interface NewJobData {
  templates: any[]
  clients: any[]
  fromCache: boolean
}

/** Fetch + refresh the cache when online; fall back to the cache when offline. */
export async function loadNewJobData(): Promise<NewJobData> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('offline')
    const supabase = createClient()
    const [{ data: tmpl, error: tErr }, { data: cls }] = await Promise.all([
      supabase.from('checklist_templates')
        .select('*, sections:template_sections(*, fields:template_fields(*))')
        .eq('status', 'active').eq('allow_surveyor_start', true).order('name'),
      supabase.from('clients').select('*').eq('is_active', true).order('name'),
    ])
    if (tErr) throw tErr

    // Normalise: sort sections + fields by order_index so the editor renders them right.
    const templates = (tmpl ?? []).map((t: any) => ({
      ...t,
      sections: [...(t.sections ?? [])]
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .map((s: any) => ({ ...s, fields: [...(s.fields ?? [])].sort((a: any, b: any) => a.order_index - b.order_index) })),
    }))

    const payload: CachedNewJobData = { templates, clients: cls ?? [], cachedAt: Date.now() }
    await cacheNewJobData(payload).catch(() => {})
    return { templates: payload.templates, clients: payload.clients, fromCache: false }
  } catch {
    const cached = await getCachedNewJobData().catch(() => undefined)
    return {
      templates: cached?.templates ?? [],
      clients: cached?.clients ?? [],
      fromCache: true,
    }
  }
}
