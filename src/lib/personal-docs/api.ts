// Personal (surveyor credential) documents — browser-side data access. RLS lets
// an owner manage their own, admins manage all, and office read with the
// personal_docs.view permission. Modelled on src/lib/documents/api.ts.

import { createClient } from '@/lib/supabase/client'
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'
import type { PersonalDocument } from '@/lib/types/database'

export const DOC_TYPES = [
  'Port Pass', "Driver's License", 'Passport', 'Certificate of Good Character (COC)',
  'Medical', 'Safety Training', 'Other',
]

const BUCKET = 'personal-documents'

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export type ExpiryStatus = 'expired' | 'expiring' | 'ok' | 'none'

/** Days until expiry (negative = past) + a status banded by the reminder lead. */
export function expiryStatus(expiry: string | null, leadDays: number): { status: ExpiryStatus; days: number | null } {
  if (!expiry) return { status: 'none', days: null }
  const d = parseISO(expiry)
  if (!isValid(d)) return { status: 'none', days: null }
  const days = differenceInCalendarDays(d, new Date())
  if (days < 0) return { status: 'expired', days }
  if (days <= leadDays) return { status: 'expiring', days }
  return { status: 'ok', days }
}

export interface DocInput {
  doc_name: string
  doc_type?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  reminder_lead_days?: number
  notes?: string | null
}

export async function listDocuments(profileId: string): Promise<PersonalDocument[]> {
  const { data } = await createClient()
    .from('personal_documents').select('*').eq('profile_id', profileId)
    .order('expiry_date', { ascending: true, nullsFirst: false })
  return (data ?? []) as PersonalDocument[]
}

export async function addDocument(profileId: string, meta: DocInput, file: File | null): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let storage_path: string | null = null
  let content_type: string | null = null
  let size_bytes: number | null = null

  if (file) {
    storage_path = `${profileId}/${crypto.randomUUID()}_${safeName(file.name)}`
    content_type = file.type || 'application/octet-stream'
    size_bytes = file.size
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storage_path, file, { contentType: content_type, upsert: false })
    if (upErr) return { error: upErr.message }
  }

  const { error } = await supabase.from('personal_documents').insert({
    profile_id: profileId,
    doc_name: meta.doc_name.trim(),
    doc_type: meta.doc_type || null,
    issue_date: meta.issue_date || null,
    expiry_date: meta.expiry_date || null,
    reminder_lead_days: meta.reminder_lead_days ?? 60,
    notes: meta.notes || null,
    storage_path, content_type, size_bytes,
    uploaded_by: user?.id ?? null,
  })
  if (error) {
    if (storage_path) await supabase.storage.from(BUCKET).remove([storage_path]).catch(() => {})
    return { error: error.message }
  }
  return {}
}

export async function updateDocument(doc: PersonalDocument, meta: DocInput, file: File | null): Promise<{ error?: string }> {
  const supabase = createClient()
  const patch: Record<string, any> = {
    doc_name: meta.doc_name.trim(),
    doc_type: meta.doc_type || null,
    issue_date: meta.issue_date || null,
    expiry_date: meta.expiry_date || null,
    reminder_lead_days: meta.reminder_lead_days ?? doc.reminder_lead_days,
    notes: meta.notes || null,
  }
  let oldPath: string | null = null
  if (file) {
    const newPath = `${doc.profile_id}/${crypto.randomUUID()}_${safeName(file.name)}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(newPath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) return { error: upErr.message }
    oldPath = doc.storage_path
    patch.storage_path = newPath
    patch.content_type = file.type || null
    patch.size_bytes = file.size
  }
  const { error } = await supabase.from('personal_documents').update(patch).eq('id', doc.id)
  if (error) return { error: error.message }
  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {})
  return {}
}

export async function deleteDocument(doc: PersonalDocument): Promise<{ error?: string }> {
  const supabase = createClient()
  if (doc.storage_path) await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => {})
  const { error } = await supabase.from('personal_documents').delete().eq('id', doc.id)
  return { error: error?.message }
}

export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await createClient().storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export interface ExpiringDoc extends PersonalDocument {
  owner_name: string
  status: ExpiryStatus
  days: number | null
}

/** Documents expired or within their reminder lead. `profileId` scopes to one
 *  owner (surveyor view); omit for the admin-wide view (RLS gates access). */
export async function listExpiring(profileId?: string): Promise<ExpiringDoc[]> {
  let q = createClient()
    .from('personal_documents')
    .select('*, owner:profiles!personal_documents_profile_id_fkey(full_name)')
    .not('expiry_date', 'is', null)
  if (profileId) q = q.eq('profile_id', profileId)
  const { data } = await q
  const rows = (data ?? []) as any[]
  return rows
    .map(d => {
      const { status, days } = expiryStatus(d.expiry_date, d.reminder_lead_days)
      return { ...d, owner_name: d.owner?.full_name ?? '', status, days } as ExpiringDoc
    })
    .filter(d => d.status === 'expired' || d.status === 'expiring')
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0))
}
