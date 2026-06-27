// Personal (surveyor credential) documents — browser-side data access. RLS lets
// an owner manage their own, admins manage all, and office read with the
// personal_docs.view permission. Modelled on src/lib/documents/api.ts.

import { createClient } from '@/lib/supabase/client'
import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'
import { formatBytes, sanitizeStorageName } from '@/lib/utils'
import type { PersonalDocument, CredentialKey } from '@/lib/types/database'

// Re-exported so existing consumers can keep importing formatBytes from here.
export { formatBytes }

export const DOC_TYPES = [
  'Port Pass', 'Medical', 'Safety Training', 'Reference', 'Other',
]

/** Known credentials — each is ONE personal_documents row (number + expiry +
 *  file together). Insurance adds company/type; CoC has a receipt→full stage. */
export interface CredentialDef {
  key: CredentialKey
  label: string
  numberLabel: string
  insurance?: boolean
  coc?: boolean
}
export const CREDENTIALS: CredentialDef[] = [
  { key: 'drivers_permit', label: "Driver's permit", numberLabel: 'Permit number' },
  { key: 'id_card',        label: 'ID card',          numberLabel: 'ID card number' },
  { key: 'passport',       label: 'Passport',         numberLabel: 'Passport number' },
  { key: 'insurance',      label: 'Insurance',        numberLabel: 'Policy number', insurance: true },
  { key: 'coc',            label: 'Certificate of Character (CoC)', numberLabel: 'CoC number', coc: true },
]
export function credentialDef(key: CredentialKey): CredentialDef {
  return CREDENTIALS.find(c => c.key === key)!
}

const BUCKET = 'personal-documents'

export type ExpiryStatus = 'expired' | 'expiring' | 'ok' | 'none'

/** A positive reminder lead in days, falling back to 60 (guards against a blank
 *  input becoming Number('')===0, which would silently disable reminders). */
function leadDaysOr(value: number | null | undefined, fallback = 60): number {
  return value && value > 0 ? value : fallback
}

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

/** Free-form "other" documents only (known credentials are managed separately). */
export async function listDocuments(profileId: string): Promise<PersonalDocument[]> {
  const { data } = await createClient()
    .from('personal_documents').select('*').eq('profile_id', profileId)
    .is('credential_key', null)
    .order('expiry_date', { ascending: true, nullsFirst: false })
  return (data ?? []) as PersonalDocument[]
}

/** Every known-credential row for a person (driver's permit, ID, passport, etc.). */
export async function listCredentialRows(profileId: string): Promise<PersonalDocument[]> {
  const { data } = await createClient()
    .from('personal_documents').select('*').eq('profile_id', profileId)
    .not('credential_key', 'is', null)
  return (data ?? []) as PersonalDocument[]
}

export interface CredentialInput {
  doc_number?: string | null
  issue_date?: string | null
  expiry_date?: string | null
  reminder_lead_days?: number
  notes?: string | null
  insurance_company?: string | null
  insurance_type?: string | null
}

/** Upsert a known credential (one row per person+credential[+CoC stage]). A new
 *  file replaces the previous one. Saving the CoC "full" certificate auto-removes
 *  the receipt. Pass `file = null` to keep the existing file (or none). */
export async function saveCredential(
  profileId: string, def: CredentialDef, input: CredentialInput,
  file: File | null, stage?: 'receipt' | 'full',
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let q = supabase.from('personal_documents').select('*')
    .eq('profile_id', profileId).eq('credential_key', def.key)
  q = def.coc ? q.eq('coc_stage', stage ?? 'full') : q.is('coc_stage', null)
  const { data: rows } = await q
  const existing = (rows ?? [])[0] as PersonalDocument | undefined

  const docName = def.coc
    ? (stage === 'receipt' ? 'CoC receipt' : 'Certificate of Character')
    : def.label

  let storage_path = existing?.storage_path ?? null
  let content_type = existing?.content_type ?? null
  let size_bytes = existing?.size_bytes ?? null
  let oldPath: string | null = null
  if (file) {
    const newPath = `${profileId}/${crypto.randomUUID()}_${sanitizeStorageName(file.name)}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(newPath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upErr) return { error: upErr.message }
    oldPath = existing?.storage_path ?? null
    storage_path = newPath
    content_type = file.type || null
    size_bytes = file.size
  }

  const row: Record<string, any> = {
    profile_id: profileId,
    credential_key: def.key,
    coc_stage: def.coc ? (stage ?? 'full') : null,
    doc_name: docName,
    doc_type: def.label,
    doc_number: input.doc_number || null,
    issue_date: input.issue_date || null,
    expiry_date: input.expiry_date || null,
    reminder_lead_days: leadDaysOr(input.reminder_lead_days, existing?.reminder_lead_days ?? 60),
    notes: input.notes || null,
    insurance_company: def.insurance ? (input.insurance_company || null) : null,
    insurance_type: def.insurance ? (input.insurance_type || null) : null,
    storage_path, content_type, size_bytes,
    uploaded_by: user?.id ?? null,
  }

  const { error } = existing
    ? await supabase.from('personal_documents').update(row).eq('id', existing.id)
    : await supabase.from('personal_documents').insert(row)
  if (error) {
    if (file && storage_path) await supabase.storage.from(BUCKET).remove([storage_path]).catch(() => {})
    return { error: error.message }
  }
  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => {})

  // CoC: the full certificate supersedes (and removes) the receipt.
  if (def.coc && stage === 'full') {
    const { data: receipts } = await supabase.from('personal_documents').select('id, storage_path')
      .eq('profile_id', profileId).eq('credential_key', 'coc').eq('coc_stage', 'receipt')
    for (const r of (receipts ?? []) as any[]) {
      if (r.storage_path) await supabase.storage.from(BUCKET).remove([r.storage_path]).catch(() => {})
      await supabase.from('personal_documents').delete().eq('id', r.id)
    }
  }
  return {}
}

export async function addDocument(profileId: string, meta: DocInput, file: File | null): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  let storage_path: string | null = null
  let content_type: string | null = null
  let size_bytes: number | null = null

  if (file) {
    storage_path = `${profileId}/${crypto.randomUUID()}_${sanitizeStorageName(file.name)}`
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
    reminder_lead_days: leadDaysOr(meta.reminder_lead_days),
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
    reminder_lead_days: leadDaysOr(meta.reminder_lead_days, doc.reminder_lead_days),
    notes: meta.notes || null,
  }
  let oldPath: string | null = null
  if (file) {
    const newPath = `${doc.profile_id}/${crypto.randomUUID()}_${sanitizeStorageName(file.name)}`
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
