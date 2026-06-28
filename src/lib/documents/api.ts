// Vessel document library — browser-side data access (Supabase). Active staff only
// (enforced by RLS). Documents live in the private 'vessel-documents' bucket.

import { createClient } from '@/lib/supabase/client'
import { formatBytes, sanitizeStorageName } from '@/lib/utils'

// Re-exported so existing consumers (e.g. the document views) can keep importing
// formatBytes from this module's public surface.
export { formatBytes }

export interface VesselFolder {
  id: string
  name: string
  created_at?: string
  docCount?: number
}

export interface VesselDocument {
  id: string
  vessel_id: string
  name: string
  category: string | null
  storage_path: string
  content_type: string | null
  size_bytes: number | null
  created_at: string
}

export interface DocumentHit extends VesselDocument {
  vessel_name: string
}

export const DOC_CATEGORIES = ['Sounding Tables', 'Hydrostatic Tables', 'General Arrangement', 'Stability', 'Capacity Plan', 'Other']

const BUCKET = 'vessel-documents'

// --- Vessels (folders) ---
export async function listVesselFolders(): Promise<VesselFolder[]> {
  const supabase = createClient()
  const [{ data: vessels }, { data: docs }] = await Promise.all([
    supabase.from('vessels').select('id, name, created_at').order('name'),
    supabase.from('vessel_documents').select('vessel_id'),
  ])
  const counts = new Map<string, number>()
  for (const d of docs ?? []) counts.set(d.vessel_id, (counts.get(d.vessel_id) ?? 0) + 1)
  return (vessels ?? []).map(v => ({ ...v, docCount: counts.get(v.id) ?? 0 }))
}

export async function getVessel(id: string): Promise<VesselFolder | null> {
  const { data } = await createClient().from('vessels').select('id, name, created_at').eq('id', id).single()
  return data ?? null
}

export async function createVessel(name: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('vessels').insert({ name: name.trim(), created_by: user?.id })
  return { error: error?.message }
}

export async function renameVessel(id: string, name: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('vessels').update({ name: name.trim() }).eq('id', id)
  return { error: error?.message }
}

export async function deleteVesselFolder(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const docs = await listDocuments(id)
  const paths = docs.map(d => d.storage_path).filter(Boolean)
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths).catch(() => {})
  const { error } = await supabase.from('vessels').delete().eq('id', id)
  return { error: error?.message }
}

// --- Documents ---
export async function listDocuments(vesselId: string): Promise<VesselDocument[]> {
  const { data } = await createClient()
    .from('vessel_documents').select('*').eq('vessel_id', vesselId).order('created_at', { ascending: false })
  return (data ?? []) as VesselDocument[]
}

export async function uploadDocument(vesselId: string, file: File, category: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const path = `${vesselId}/${crypto.randomUUID()}_${sanitizeStorageName(file.name)}`
  const { error: upErr } = await supabase.storage.from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: upErr.message }
  const { error } = await supabase.from('vessel_documents').insert({
    vessel_id: vesselId, name: file.name, category: category || null, storage_path: path,
    content_type: file.type || null, size_bytes: file.size, uploaded_by: user?.id,
  })
  if (error) { await supabase.storage.from(BUCKET).remove([path]).catch(() => {}); return { error: error.message } }
  return {}
}

export async function deleteDocument(doc: VesselDocument): Promise<{ error?: string }> {
  const supabase = createClient()
  await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {})
  const { error } = await supabase.from('vessel_documents').delete().eq('id', doc.id)
  return { error: error?.message }
}

/** Short-lived signed URL for download/preview. */
export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await createClient().storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

/** Search documents by name across all vessels (for the global search box). */
export async function searchDocuments(query: string): Promise<DocumentHit[]> {
  const { data } = await createClient()
    .from('vessel_documents')
    .select('*, vessels(name)')
    .ilike('name', `%${query}%`)
    .limit(50)
  return (data ?? []).map((d: any) => ({ ...d, vessel_name: d.vessels?.name ?? '' }))
}
