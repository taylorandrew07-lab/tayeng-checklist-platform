// Job → report tracker: workflow config + data access. The job is the central
// tracker line; this layer adds the ops lifecycle, multi-surveyor assignment,
// report/VOS attachments, and an activity trail on top of the jobs table.

import { createClient } from '@/lib/supabase/client'
import type { WorkflowStatus, JobType, JobAttachment, JobAttachmentKind, ActivityLogRow } from '@/lib/types/database'

const FILES_BUCKET = 'job-files'

// ── Workflow lifecycle ──────────────────────────────────────────────────────
export const WORKFLOW_ORDER: WorkflowStatus[] = [
  'new', 'assigned', 'report_uploaded', 'report_approved', 'invoiced', 'sent', 'paid', 'closed',
]

export const WORKFLOW: Record<WorkflowStatus, { label: string; pill: string; dot: string }> = {
  new:             { label: 'New',             pill: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400' },
  assigned:        { label: 'Assigned',        pill: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  report_uploaded: { label: 'Report uploaded', pill: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  report_approved: { label: 'Report approved', pill: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  invoiced:        { label: 'Invoiced',        pill: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500' },
  sent:            { label: 'Sent',            pill: 'bg-cyan-100 text-cyan-700',     dot: 'bg-cyan-500' },
  paid:            { label: 'Paid',            pill: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
  closed:          { label: 'Closed',          pill: 'bg-slate-200 text-slate-600',   dot: 'bg-slate-500' },
}

export const ATTACHMENT_KINDS: { kind: JobAttachmentKind; label: string }[] = [
  { kind: 'preliminary', label: 'Preliminary report' },
  { kind: 'final', label: 'Final report' },
  { kind: 'vos', label: 'VOS (verification of service)' },
  { kind: 'time_page', label: 'Time page' },
  { kind: 'other', label: 'Other' },
]
export const attachmentLabel = (k: JobAttachmentKind) => ATTACHMENT_KINDS.find(a => a.kind === k)?.label ?? k

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`
}
const safeName = (n: string) => n.replace(/[^a-zA-Z0-9._-]/g, '_')

// ── Activity trail ──────────────────────────────────────────────────────────
export async function logActivity(entity: string, entityId: string, action: string, meta?: Record<string, unknown>) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('activity_log').insert({ entity, entity_id: entityId, action, actor_id: user.id, meta: meta ?? null })
}

export async function listJobActivity(jobId: string): Promise<(ActivityLogRow & { actor_name: string | null })[]> {
  const { data } = await createClient()
    .from('activity_log')
    .select('*, actor:profiles!activity_log_actor_id_fkey(full_name)')
    .eq('entity', 'job').eq('entity_id', jobId)
    .order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map(r => ({ ...r, actor_name: r.actor?.full_name ?? null }))
}

// ── Workflow transitions ────────────────────────────────────────────────────
export async function setWorkflowStatus(jobId: string, next: WorkflowStatus): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const patch: Record<string, any> = { workflow_status: next }
  if (next === 'report_approved') { patch.report_approved_at = new Date().toISOString(); patch.report_approved_by = user?.id ?? null }
  if (next === 'paid') patch.paid_at = new Date().toISOString()
  if (next === 'closed') { patch.closed_at = new Date().toISOString(); patch.closed_by = user?.id ?? null }
  const { error } = await supabase.from('jobs').update(patch).eq('id', jobId)
  if (error) return { error: error.message }
  await logActivity('job', jobId, `workflow:${next}`)
  return {}
}

// ── Pick lists ──────────────────────────────────────────────────────────────
export async function listJobTypes(): Promise<JobType[]> {
  const { data } = await createClient().from('job_types').select('*').eq('is_active', true).order('name')
  return (data ?? []) as JobType[]
}

export interface SurveyorAccount { id: string; full_name: string; role: string; display_title: string | null }
export async function listSurveyorAccounts(): Promise<SurveyorAccount[]> {
  const { data } = await createClient()
    .from('profiles').select('id, full_name, role, display_title')
    .in('role', ['surveyor', 'admin']).eq('is_active', true).order('full_name')
  return (data ?? []) as SurveyorAccount[]
}

// ── Multi-surveyor assignment ───────────────────────────────────────────────
export interface JobSurveyorRow { id: string; surveyor_id: string; full_name: string; role: string; display_title: string | null }
export async function listJobSurveyors(jobId: string): Promise<JobSurveyorRow[]> {
  const { data } = await createClient()
    .from('job_surveyors')
    .select('id, surveyor_id, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, role, display_title)')
    .eq('job_id', jobId)
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, surveyor_id: r.surveyor_id,
    full_name: r.surveyor?.full_name ?? '', role: r.surveyor?.role ?? '', display_title: r.surveyor?.display_title ?? null,
  }))
}

export async function addJobSurveyor(jobId: string, surveyorId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { error } = await supabase.from('job_surveyors').insert({ job_id: jobId, surveyor_id: surveyorId, created_by: user?.id ?? null })
  if (error) return { error: error.message }
  await logActivity('job', jobId, 'surveyor:add', { surveyor_id: surveyorId })
  return {}
}

export async function removeJobSurveyor(rowId: string, jobId: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_surveyors').delete().eq('id', rowId)
  if (error) return { error: error.message }
  await logActivity('job', jobId, 'surveyor:remove', { row_id: rowId })
  return {}
}

// ── Attachments (reports / VOS / time pages) ────────────────────────────────
export async function listJobAttachments(jobId: string): Promise<JobAttachment[]> {
  const { data } = await createClient()
    .from('job_attachments').select('*').eq('job_id', jobId).order('created_at', { ascending: false })
  return (data ?? []) as JobAttachment[]
}

export async function uploadJobAttachment(jobId: string, kind: JobAttachmentKind, file: File): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const path = `${jobId}/${crypto.randomUUID()}_${safeName(file.name)}`
  const { error: upErr } = await supabase.storage.from(FILES_BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: upErr.message }
  const { error } = await supabase.from('job_attachments').insert({
    job_id: jobId, kind, doc_name: file.name, storage_path: path,
    content_type: file.type || null, size_bytes: file.size, uploaded_by: user?.id ?? null,
  })
  if (error) { await supabase.storage.from(FILES_BUCKET).remove([path]).catch(() => {}); return { error: error.message } }
  await logActivity('job', jobId, `attachment:${kind}`, { name: file.name })
  return {}
}

export async function deleteJobAttachment(att: JobAttachment): Promise<{ error?: string }> {
  const supabase = createClient()
  if (att.storage_path) await supabase.storage.from(FILES_BUCKET).remove([att.storage_path]).catch(() => {})
  const { error } = await supabase.from('job_attachments').delete().eq('id', att.id)
  if (!error) await logActivity('job', att.job_id, 'attachment:delete', { name: att.doc_name })
  return { error: error?.message }
}

export async function jobFileUrl(path: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await createClient().storage.from(FILES_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}
