// Load admin-managed cargo templates for surveyor voyage creation. When online,
// fetch active templates from Supabase and refresh the local cache; when offline,
// fall back to the cached copy so voyages can still be started without internet.

import { createClient } from '@/lib/supabase/client'
import { cacheTemplates, getCachedTemplates } from './db'
import { defaultReadingTypes, normalizeReadingTypes, type CargoTemplate, type ReadingType } from './types'

function normalize(row: any): CargoTemplate {
  // The client name arrives as an embed on default_client_id (see the select
  // below), which PostgREST returns as an object or, on some shapes, a
  // one-element array. Tolerate both — a missing name is not an error, it just
  // means the offline text-mode client box has nothing to seed.
  const emb = Array.isArray(row.default_client) ? row.default_client[0] : row.default_client
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    default_hold_count: row.default_hold_count ?? 5,
    default_cargo_type: row.default_cargo_type ?? null,
    default_loading_port: row.default_loading_port ?? null,
    default_discharge_port: row.default_discharge_port ?? null,
    default_client_id: row.default_client_id ?? null,
    default_client_name: emb?.name ?? null,
    reading_types: normalizeReadingTypes(Array.isArray(row.reading_types) ? (row.reading_types as ReadingType[]) : []),
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
      // One FK to clients here, so a plain named embed is unambiguous — this is
      // not the two-FK invoice case that needs an explicit constraint hint.
      .select('*, default_client:clients!cargo_templates_default_client_id_fkey(name)')
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
    // Blank means blank: no template was chosen, so nothing is pre-filled.
    default_cargo_type: null,
    default_loading_port: null,
    default_discharge_port: null,
    default_client_id: null,
    default_client_name: null,
    reading_types: defaultReadingTypes(),
    status: 'active',
  }
}
