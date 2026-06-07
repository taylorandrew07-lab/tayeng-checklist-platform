// Load admin-managed cargo templates for surveyor voyage creation. When online,
// fetch active templates from Supabase and refresh the local cache; when offline,
// fall back to the cached copy so voyages can still be started without internet.

import { createClient } from '@/lib/supabase/client'
import { cacheTemplates, getCachedTemplates } from './db'
import { defaultReadingTypes, type CargoTemplate, type ReadingType } from './types'

function normalize(row: any): CargoTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    default_hold_count: row.default_hold_count ?? 5,
    reading_types: Array.isArray(row.reading_types) ? (row.reading_types as ReadingType[]) : [],
    status: row.status ?? 'active',
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * Active cargo templates for the surveyor. Tries the network first (and refreshes
 * the offline cache); on any failure returns whatever is cached locally.
 */
export async function loadActiveTemplates(): Promise<CargoTemplate[]> {
  try {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('cargo_templates')
      .select('*')
      .eq('status', 'active')
      .order('name')
    if (error) throw error
    const templates = (data ?? []).map(normalize)
    await cacheTemplates(templates).catch(() => {})
    return templates
  } catch {
    return await getCachedTemplates().catch(() => [])
  }
}

/** A blank pseudo-template (no template) seeded with the default reading set. */
export function blankTemplate(): CargoTemplate {
  return {
    id: '',
    name: 'Blank (no template)',
    description: null,
    default_hold_count: 5,
    reading_types: defaultReadingTypes(),
    status: 'active',
  }
}
