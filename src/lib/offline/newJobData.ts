// Data needed to START a new job from a template. Cached locally so a surveyor can
// begin a checklist with no signal. Only surveyor-startable active templates are
// included (RLS requires allow_surveyor_start to create the job on sync).

import { createClient } from '@/lib/supabase/client'
import { listSurveyorAccounts } from '@/lib/jobs/tracker'
import { cacheNewJobData, getCachedNewJobData, type CachedNewJobData } from './db'

export interface NewJobData {
  templates: any[]
  clients: any[]
  jobTypes: any[]
  /** Surveyor accounts for the co-surveyor picker (empty on a device that hasn't
   *  cached them yet — the picker just doesn't show until it's been online once). */
  surveyors: any[]
  fromCache: boolean
}

/** Fetch + refresh the cache when online; fall back to the cache when offline. */
export async function loadNewJobData(): Promise<NewJobData> {
  try {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('offline')
    const supabase = createClient()
    const [{ data: tmpl, error: tErr }, { data: cls }, { data: jt, error: jtErr }, srv] = await Promise.all([
      supabase.from('checklist_templates')
        .select('*, sections:template_sections(*, fields:template_fields(*))')
        .eq('status', 'active').eq('allow_surveyor_start', true).order('name'),
      supabase.from('clients').select('*').eq('is_active', true).order('name'),
      // Job types for the create form's picker — readable by any active staff
      // member ("Staff read job types", migration 042).
      supabase.from('job_types').select('*').eq('is_active', true).order('name'),
      // Surveyor accounts for the co-surveyor picker (surveyors may read surveyor
      // profiles, mig 002). Returns [] rather than throwing, so a permission hiccup
      // just leaves the picker empty instead of blocking the whole load.
      listSurveyorAccounts().catch(() => []),
    ])
    if (tErr) throw tErr

    // Normalise: sort sections + fields by order_index so the editor renders them right.
    const templates = (tmpl ?? []).map((t: any) => ({
      ...t,
      sections: [...(t.sections ?? [])]
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .map((s: any) => ({ ...s, fields: [...(s.fields ?? [])].sort((a: any, b: any) => a.order_index - b.order_index) })),
    }))

    // A failed or empty job-types read must not overwrite a good cached list: the
    // form would silently drop to its read-only fallback and tell the surveyor to
    // connect once — which is exactly what had just cleared it. Carry the last
    // known list forward instead.
    let jobTypes = jt ?? []
    if (jtErr || jobTypes.length === 0) {
      const previous = await getCachedNewJobData().catch(() => undefined)
      if (previous?.jobTypes?.length) jobTypes = previous.jobTypes
    }

    // A failed/empty surveyor read carries the last cached list forward, same as
    // job types — never blank a good picker because one load was degraded.
    let surveyors = srv ?? []
    if (surveyors.length === 0) {
      const previous = await getCachedNewJobData().catch(() => undefined)
      if (previous?.surveyors?.length) surveyors = previous.surveyors
    }

    const payload: CachedNewJobData = { templates, clients: cls ?? [], jobTypes, surveyors, cachedAt: Date.now() }
    await cacheNewJobData(payload).catch(() => {})
    return { templates: payload.templates, clients: payload.clients, jobTypes: payload.jobTypes ?? [], surveyors: payload.surveyors ?? [], fromCache: false }
  } catch {
    const cached = await getCachedNewJobData().catch(() => undefined)
    return {
      templates: cached?.templates ?? [],
      clients: cached?.clients ?? [],
      // Empty on a device cached before job types were added — the form falls back
      // to the template's default type rather than blocking the create.
      jobTypes: cached?.jobTypes ?? [],
      surveyors: cached?.surveyors ?? [],
      fromCache: true,
    }
  }
}
