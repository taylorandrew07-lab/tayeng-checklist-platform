// Job → report tracker: workflow config + data access. The job is the central
// tracker line; this layer adds the ops lifecycle, multi-surveyor assignment,
// report/VOS attachments, and an activity trail on top of the jobs table.

import { createClient } from '@/lib/supabase/client'
import type { WorkflowStatus, JobType, JobAttachment, JobAttachmentKind, ActivityLogRow } from '@/lib/types/database'

const FILES_BUCKET = 'job-files'

// ── Workflow lifecycle ──────────────────────────────────────────────────────
export const WORKFLOW_ORDER: WorkflowStatus[] = [
  'new', 'assigned', 'in_progress', 'report_ready', 'approved', 'invoiced', 'sent', 'paid', 'closed',
]

export const WORKFLOW: Record<WorkflowStatus, { label: string; pill: string; dot: string }> = {
  new:          { label: 'New',          pill: 'bg-gray-100 text-gray-600',     dot: 'bg-gray-400' },
  assigned:     { label: 'Assigned',     pill: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500' },
  in_progress:  { label: 'In progress',  pill: 'bg-sky-100 text-sky-700',       dot: 'bg-sky-500' },
  report_ready: { label: 'Report ready', pill: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  approved:     { label: 'Approved',     pill: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  invoiced:     { label: 'Invoiced',     pill: 'bg-amber-100 text-amber-700',   dot: 'bg-amber-500' },
  sent:         { label: 'Sent',         pill: 'bg-teal-100 text-teal-700',     dot: 'bg-teal-500' },
  paid:         { label: 'Paid',         pill: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
  closed:       { label: 'Closed',       pill: 'bg-slate-200 text-slate-600',   dot: 'bg-slate-500' },
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

export const CURRENCIES = ['USD', 'TTD', 'EUR', 'GBP'] as const
export function money(n: number, currency = 'USD'): string {
  return `${currency} ${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

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
  if (next === 'approved') { patch.report_approved_at = new Date().toISOString(); patch.report_approved_by = user?.id ?? null }
  if (next === 'paid') patch.paid_at = new Date().toISOString()
  if (next === 'closed') { patch.closed_at = new Date().toISOString(); patch.closed_by = user?.id ?? null }
  const { error } = await supabase.from('jobs').update(patch).eq('id', jobId)
  if (error) return { error: error.message }
  await logActivity('job', jobId, `workflow:${next}`)
  return {}
}

/** Advance a job to `target` only if it hasn't already reached/passed it — used
 *  to sync the workflow from checklist activity without ever pulling it back. */
export async function advanceWorkflowTo(jobId: string, target: WorkflowStatus): Promise<void> {
  const supabase = createClient()
  const ti = WORKFLOW_ORDER.indexOf(target)
  if (ti < 0) return
  // Atomic forward-only advance: the DB itself excludes rows already at/after the
  // target (the WHERE is evaluated at update time), so two concurrent advances
  // can't race a read-then-write and pull the stage backward. Only log when a row
  // actually changed.
  const atOrAfter = WORKFLOW_ORDER.slice(ti)
  const { data } = await supabase.from('jobs')
    .update({ workflow_status: target })
    .eq('id', jobId)
    .not('workflow_status', 'in', `(${atOrAfter.join(',')})`)
    .select('id')
  if (data && data.length) await logActivity('job', jobId, `workflow:${target}`)
}

// ── Client-facing status (simplified — hides billing internals) ─────────────
export type ClientStatus = 'in_progress' | 'report_ready' | 'completed' | 'closed'
export const CLIENT_STATUS: Record<ClientStatus, { label: string; pill: string; dot: string }> = {
  in_progress:  { label: 'In progress',  pill: 'bg-sky-100 text-sky-700',       dot: 'bg-sky-500' },
  report_ready: { label: 'Report ready', pill: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  completed:    { label: 'Completed',    pill: 'bg-green-100 text-green-700',   dot: 'bg-green-500' },
  closed:       { label: 'Closed',       pill: 'bg-slate-200 text-slate-600',   dot: 'bg-slate-500' },
}
export function clientStatusFor(ws: WorkflowStatus): ClientStatus {
  switch (ws) {
    case 'report_ready': return 'report_ready'
    case 'approved': case 'invoiced': case 'sent': case 'paid': return 'completed'
    case 'closed': return 'closed'
    default: return 'in_progress' // new / assigned / in_progress
  }
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
export interface JobSurveyorRow {
  id: string; surveyor_id: string; full_name: string; role: string; display_title: string | null
  regular_hours: number; overtime_hours: number
  pay_rate: number | null; overtime_rate: number | null; pay_currency: string
  regular_pay: number; overtime_pay: number
}
export async function listJobSurveyors(jobId: string): Promise<JobSurveyorRow[]> {
  const { data } = await createClient()
    .from('job_surveyors')
    .select('id, surveyor_id, regular_hours, overtime_hours, pay_rate, overtime_rate, pay_currency, regular_pay, overtime_pay, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, role, display_title)')
    .eq('job_id', jobId)
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, surveyor_id: r.surveyor_id,
    full_name: r.surveyor?.full_name ?? '', role: r.surveyor?.role ?? '', display_title: r.surveyor?.display_title ?? null,
    regular_hours: Number(r.regular_hours ?? 0), overtime_hours: Number(r.overtime_hours ?? 0),
    pay_rate: r.pay_rate, overtime_rate: r.overtime_rate, pay_currency: r.pay_currency ?? 'TTD',
    regular_pay: Number(r.regular_pay ?? 0), overtime_pay: Number(r.overtime_pay ?? 0),
  }))
}

/** Surveyor-or-admin: update the hours on a job↔surveyor line. */
export async function updateJobSurveyorHours(rowId: string, jobId: string, hours: { regular_hours: number; overtime_hours: number }): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_surveyors')
    .update({ regular_hours: hours.regular_hours, overtime_hours: hours.overtime_hours }).eq('id', rowId)
  if (error) return { error: error.message }
  await logActivity('job', jobId, 'hours:update', hours)
  return {}
}

/** Admin only (trigger-enforced): set a surveyor's pay rates on a job. */
export async function updateJobSurveyorRates(rowId: string, jobId: string, rates: { pay_rate: number | null; overtime_rate: number | null; pay_currency: string }): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_surveyors')
    .update({ pay_rate: rates.pay_rate, overtime_rate: rates.overtime_rate, pay_currency: rates.pay_currency }).eq('id', rowId)
  if (error) return { error: error.message }
  await logActivity('job', jobId, 'rates:update')
  return {}
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

/** Upload allowlist — mirrors the server-side bucket limits (migration 049). */
const UPLOAD_ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
const UPLOAD_MAX_BYTES = 25 * 1024 * 1024

export async function uploadJobAttachment(jobId: string, kind: JobAttachmentKind, file: File): Promise<{ error?: string }> {
  if (file.size > UPLOAD_MAX_BYTES) return { error: 'File is too large (max 25 MB).' }
  if (file.type && !UPLOAD_ALLOWED_MIME.includes(file.type)) return { error: 'Only PDF or image files (JPG, PNG, WebP) are allowed.' }
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

// ── Jobs Tracker table (Airtable-style grid) ────────────────────────────────
export interface TrackerRow {
  id: string
  report_number: string | null
  job_type: string | null
  vessel_name: string | null
  title: string
  client_id: string | null
  client_name: string | null
  workflow_status: WorkflowStatus
  status: string
  is_overtime: boolean
  scheduled_date: string | null
  created_at: string
  surveyors: string[]
  regular_hours: number
  overtime_hours: number
  invoice_number: string | null
  invoice_status: string | null
  invoice_total: number | null
  invoice_currency: string | null
}

/** One row per job with surveyor names + hours and any invoice, joined in JS. */
export async function listJobTrackerRows(): Promise<TrackerRow[]> {
  const supabase = createClient()
  const [{ data: jobs }, { data: js }, { data: invs }] = await Promise.all([
    supabase.from('jobs')
      .select('id, report_number, job_type, vessel_name, title, surveyor_name, client_id, workflow_status, status, is_overtime, scheduled_date, created_at, client:clients(name)')
      .order('created_at', { ascending: false }),
    supabase.from('job_surveyors')
      .select('job_id, regular_hours, overtime_hours, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, display_title)'),
    supabase.from('invoices').select('job_id, invoice_number, status, total, currency'),
  ])

  const sMap = new Map<string, { names: string[]; reg: number; ot: number }>()
  for (const r of (js ?? []) as any[]) {
    let e = sMap.get(r.job_id); if (!e) { e = { names: [], reg: 0, ot: 0 }; sMap.set(r.job_id, e) }
    const n = r.surveyor?.display_title ?? r.surveyor?.full_name; if (n) e.names.push(n)
    e.reg += Number(r.regular_hours ?? 0); e.ot += Number(r.overtime_hours ?? 0)
  }
  const iMap = new Map<string, any>()
  for (const inv of (invs ?? []) as any[]) if (inv.job_id && !iMap.has(inv.job_id)) iMap.set(inv.job_id, inv)

  return ((jobs ?? []) as any[]).map(j => {
    const s = sMap.get(j.id); const inv = iMap.get(j.id)
    // Prefer the multi-surveyor table; fall back to the legacy single name so
    // jobs assigned the old way still show their surveyor.
    const surveyors = s?.names.length ? s.names : (j.surveyor_name ? [j.surveyor_name] : [])
    return {
      id: j.id, report_number: j.report_number, job_type: j.job_type, vessel_name: j.vessel_name, title: j.title,
      client_id: j.client_id, client_name: j.client?.name ?? null,
      workflow_status: j.workflow_status, status: j.status, is_overtime: !!j.is_overtime, scheduled_date: j.scheduled_date, created_at: j.created_at,
      surveyors, regular_hours: s?.reg ?? 0, overtime_hours: s?.ot ?? 0,
      invoice_number: inv?.invoice_number ?? null, invoice_status: inv?.status ?? null,
      invoice_total: inv ? Number(inv.total ?? 0) : null, invoice_currency: inv?.currency ?? null,
    }
  })
}

/** Inline edit of a single job field from the tracker grid. */
export async function updateJobField(jobId: string, patch: Record<string, any>): Promise<{ error?: string }> {
  const { error } = await createClient().from('jobs').update(patch).eq('id', jobId)
  return { error: error?.message }
}

/** Report number `YY-MM-NNN` from a date + running sequence (matches the real docs). */
export function formatReportNumber(dateISO: string, seq: number): string {
  const d = new Date(dateISO)
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${yy}-${mm}-${String(seq).padStart(3, '0')}`
}

/** Highest NNN seen across existing report numbers (any format), 0 if none. */
export function highestReportSeq(rows: { report_number: string | null }[]): number {
  let max = 0
  for (const r of rows) {
    const m = (r.report_number ?? '').match(/(\d+)\s*$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max
}

/** Assign report numbers (date order) to jobs missing one, from a starting seq. */
export async function fillReportNumbers(
  rows: { id: string; scheduled_date: string | null; created_at: string; report_number: string | null }[],
  startSeq: number,
): Promise<{ error?: string; count: number }> {
  const supabase = createClient()
  const missing = rows
    .filter(r => !r.report_number)
    .sort((a, b) => {
      const da = a.scheduled_date ?? a.created_at, db = b.scheduled_date ?? b.created_at
      return da < db ? -1 : da > db ? 1 : 0
    })
  let seq = startSeq, count = 0
  for (const r of missing) {
    const rn = formatReportNumber(r.scheduled_date ?? r.created_at, seq)
    const { error } = await supabase.from('jobs').update({ report_number: rn }).eq('id', r.id)
    if (error) return { error: error.message, count }
    seq++; count++
  }
  return { count }
}
