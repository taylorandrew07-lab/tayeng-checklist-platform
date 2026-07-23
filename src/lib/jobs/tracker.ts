// Job → report tracker: workflow config + data access. The job is the central
// tracker line; this layer adds the ops lifecycle, multi-surveyor assignment,
// report/VOS attachments, and an activity trail on top of the jobs table.

import { createClient } from '@/lib/supabase/client'
import { formatBytes, sanitizeStorageName } from '@/lib/utils'
import type { WorkflowStatus, JobType, JobAttachment, JobAttachmentKind, ActivityLogRow } from '@/lib/types/database'

// Re-exported so existing consumers (e.g. JobOpsPanel) keep importing formatBytes
// from this module's public surface.
export { formatBytes }

const FILES_BUCKET = 'job-files'

// ── Workflow lifecycle ──────────────────────────────────────────────────────
// ORDER IS LOAD-BEARING. Both transition helpers below derive all their index
// math from this array: setWorkflowStatus clears the stamps that sit AHEAD of a
// backward move, and advanceWorkflowTo refuses to move a job that is already at
// or past the target. 'invoice_ready' must stay at index 2, before 'closed'.
export const WORKFLOW_ORDER: WorkflowStatus[] = [
  'in_progress', 'report_ready', 'invoice_ready', 'closed',
]

export const WORKFLOW: Record<WorkflowStatus, { label: string; pill: string; dot: string }> = {
  in_progress:   { label: 'In progress',   pill: 'bg-sky-100 text-sky-700',       dot: 'bg-sky-500' },
  report_ready:  { label: 'Report ready',  pill: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  invoice_ready: { label: 'Invoice ready', pill: 'bg-violet-100 text-violet-700', dot: 'bg-violet-500' },
  closed:        { label: 'Closed',        pill: 'bg-slate-200 text-slate-600',   dot: 'bg-slate-500' },
}

/** Retired pre-145 statuses → their collapsed replacement. Used to render old
 *  `workflow:*` activity-log slugs (history stays honest; only the label folds). */
export const LEGACY_WORKFLOW_ALIAS: Record<string, WorkflowStatus> = {
  new: 'in_progress', assigned: 'in_progress', report_uploaded: 'report_ready',
  approved: 'invoice_ready', report_approved: 'invoice_ready',
  invoiced: 'closed', sent: 'closed', paid: 'closed',
}

/** Normalise any status string (incl. retired ones) to a current WorkflowStatus. */
export function normalizeWorkflowStatus(s: string | null | undefined): WorkflowStatus {
  if (!s) return 'in_progress'
  if ((WORKFLOW as Record<string, unknown>)[s]) return s as WorkflowStatus
  return LEGACY_WORKFLOW_ALIAS[s] ?? 'in_progress'
}

export const ATTACHMENT_KINDS: { kind: JobAttachmentKind; label: string }[] = [
  { kind: 'preliminary', label: 'Preliminary report' },
  { kind: 'final', label: 'Final report' },
  { kind: 'vos', label: 'VOS (verification of service)' },
  { kind: 'time_page', label: 'Time page' },
  { kind: 'other', label: 'Other' },
]
export const attachmentLabel = (k: JobAttachmentKind) => ATTACHMENT_KINDS.find(a => a.kind === k)?.label ?? k

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
  // Stamp on entry; on a BACKWARD move, clear any stamp now ahead of the new status
  // so closed_at/paid_at/approved never contradict a job that was pulled back (L3).
  const ni = WORKFLOW_ORDER.indexOf(next)
  const patch: Record<string, any> = { workflow_status: next }
  // 'invoice_ready' is the admin "report finished" stamp (pre-145 this was 'approved').
  if (next === 'invoice_ready') { patch.report_approved_at = new Date().toISOString(); patch.report_approved_by = user?.id ?? null }
  else if (ni < WORKFLOW_ORDER.indexOf('invoice_ready')) { patch.report_approved_at = null; patch.report_approved_by = null }
  if (next === 'closed') { patch.closed_at = new Date().toISOString(); patch.closed_by = user?.id ?? null }
  // Moving back out of 'closed' un-stamps the close. paid_at is legacy (payment is
  // no longer tracked on the job) — clear any pre-145 value so it can't mislead.
  else if (ni < WORKFLOW_ORDER.indexOf('closed')) { patch.closed_at = null; patch.closed_by = null; patch.paid_at = null }
  // .select('id') so an RLS-filtered 0-row update (e.g. a read-only office user) is
  // detected as a denial instead of silently reporting success.
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', jobId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'That change was blocked — you may not have permission to update this job.' }
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

/** Switching a job to fixed-price means it has no billable hours — clear the
 *  logged regular/OT hours + OT shift log for every surveyor on the job so stale
 *  hours can't keep paying through the labour metrics (audit M6). Distance (km) is
 *  kept — travel is paid regardless of billing mode. Destructive; call behind a
 *  confirm. The mig-135 trigger keeps overtime_hours in step as the log is cleared. */
export async function clearJobLabourForFixed(jobId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: rows, error: rErr } = await supabase.from('job_surveyors').select('id').eq('job_id', jobId)
  if (rErr) return { error: rErr.message }
  const ids = (rows ?? []).map((r: any) => r.id)
  if (ids.length) {
    // Delete BOTH shift logs first — else their AFTER-write triggers re-derive the
    // hours back onto job_surveyors (OT via metrics_labour, regular via mig-157's
    // sync_regular_hours). Order matters: clear the logs, then zero the columns.
    const { error: oErr } = await supabase.from('job_surveyor_overtime').delete().in('job_surveyor_id', ids)
    if (oErr) return { error: oErr.message }
    const { error: rErr2 } = await supabase.from('job_surveyor_regular').delete().in('job_surveyor_id', ids)
    if (rErr2) return { error: rErr2.message }
    const { error: hErr } = await supabase.from('job_surveyors').update({ regular_hours: 0, overtime_hours: 0 }).eq('job_id', jobId)
    if (hErr) return { error: hErr.message }
  }
  return {}
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
    case 'invoice_ready': return 'completed'
    case 'closed': return 'closed'
    default: return 'in_progress'
  }
}

// ── Pick lists ──────────────────────────────────────────────────────────────
export async function listJobTypes(): Promise<JobType[]> {
  const { data } = await createClient().from('job_types').select('*').eq('is_active', true).order('name')
  return (data ?? []) as JobType[]
}

// ── Job type admin (RLS: admins manage job_types) ───────────────────────────
export interface JobTypeRow { id: string; name: string; is_active: boolean }
export async function listAllJobTypes(): Promise<JobTypeRow[]> {
  const { data } = await createClient().from('job_types').select('id, name, is_active').order('name')
  return (data ?? []) as JobTypeRow[]
}
export async function addJobType(name: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_types').insert({ name: name.trim() })
  return { error: error?.message }
}
export async function renameJobType(id: string, name: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_types').update({ name: name.trim() }).eq('id', id)
  return { error: error?.message }
}
export async function setJobTypeActive(id: string, is_active: boolean): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_types').update({ is_active }).eq('id', id)
  return { error: error?.message }
}
export async function deleteJobType(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_types').delete().eq('id', id)
  return { error: error?.message }
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
// `includeRates` MUST be false for non-admin callers. Postgres RLS can't hide columns
// (see CLAUDE.md), and a surveyor can SELECT their own job_surveyors row — so the pay
// rate / OT rate / currency / computed pay would otherwise travel to the surveyor's
// browser even though the UI hides them. When false we simply never request those
// columns and report them as null/0, so nothing sensitive leaves the server.
export async function listJobSurveyors(jobId: string, opts?: { includeRates?: boolean }): Promise<JobSurveyorRow[]> {
  const includeRates = opts?.includeRates ?? false
  const cols = includeRates
    ? 'id, surveyor_id, regular_hours, overtime_hours, pay_rate, overtime_rate, pay_currency, regular_pay, overtime_pay, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, role, display_title)'
    : 'id, surveyor_id, regular_hours, overtime_hours, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, role, display_title)'
  const { data } = await createClient().from('job_surveyors').select(cols).eq('job_id', jobId)
  return ((data ?? []) as any[]).map(r => ({
    id: r.id, surveyor_id: r.surveyor_id,
    full_name: r.surveyor?.full_name ?? '', role: r.surveyor?.role ?? '', display_title: r.surveyor?.display_title ?? null,
    regular_hours: Number(r.regular_hours ?? 0), overtime_hours: Number(r.overtime_hours ?? 0),
    pay_rate: includeRates ? r.pay_rate : null, overtime_rate: includeRates ? r.overtime_rate : null,
    pay_currency: includeRates ? (r.pay_currency ?? 'TTD') : 'TTD',
    regular_pay: includeRates ? Number(r.regular_pay ?? 0) : 0, overtime_pay: includeRates ? Number(r.overtime_pay ?? 0) : 0,
  }))
}

/** Surveyor-or-admin: update the hours on a job↔surveyor line. */
export async function updateJobSurveyorHours(rowId: string, jobId: string, hours: { regular_hours: number; overtime_hours: number }): Promise<{ error?: string }> {
  // .select('id') so an RLS-filtered 0-row update is reported as a denial, not a false success.
  const { data, error } = await createClient().from('job_surveyors')
    .update({ regular_hours: hours.regular_hours, overtime_hours: hours.overtime_hours }).eq('id', rowId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'That change was blocked — you may not have permission to update this job.' }
  await logActivity('job', jobId, 'hours:update', hours)
  return {}
}

// ── Per-surveyor overtime time-log (migration 111) ───────────────────────────
// Each entry is one shift for a surveyor on a job: a start date/time → stop date/time
// (which may cross midnight or span several days), a location, and the computed hours.
// The caller sums the entries and writes the total to job_surveyors.overtime_hours
// (which bills at the OT rate), so the log is the detail behind that one number.
export interface OvertimeEntry {
  id: string
  entry_date: string | null   // START date (YYYY-MM-DD)
  start_time: string | null   // START time (HH:MM)
  end_date: string | null     // STOP date (YYYY-MM-DD); may be a later day than entry_date
  end_time: string | null     // STOP time (HH:MM)
  hours: number
  location: string | null
  note: string | null
}

// Hours between a start date+time and a stop date+time. Handles shifts that cross
// midnight or run over several days. Returns 0 for an incomplete or non-positive span.
// Pure + timezone-free (Trinidad has no DST, but we avoid local-time parsing anyway).
export function shiftHours(startDate: string | null, startTime: string | null, endDate: string | null, endTime: string | null): number {
  if (!startDate || !startTime || !endTime) return 0
  const stop = endDate || startDate
  const toDay = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, (m || 1) - 1, dd || 1) / 86_400_000 }
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
  const totalMin = (toDay(stop) - toDay(startDate)) * 1440 + toMin(endTime) - toMin(startTime)
  return totalMin > 0 ? Math.round((totalMin / 60) * 100) / 100 : 0
}

export async function listSurveyorOvertime(jobSurveyorId: string): Promise<OvertimeEntry[]> {
  const { data } = await createClient().from('job_surveyor_overtime')
    .select('id, entry_date, start_time, end_date, end_time, hours, location, note')
    .eq('job_surveyor_id', jobSurveyorId)
    .order('entry_date', { ascending: true }).order('start_time', { ascending: true })
  return ((data ?? []) as any[]).map(r => ({ id: r.id, entry_date: r.entry_date, start_time: r.start_time, end_date: r.end_date, end_time: r.end_time, hours: Number(r.hours ?? 0), location: r.location, note: r.note }))
}

export async function addSurveyorOvertime(jobSurveyorId: string, e: { entry_date: string | null; start_time: string | null; end_date: string | null; end_time: string | null; hours: number; location: string | null; note: string | null }): Promise<{ error?: string; id?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('job_surveyor_overtime')
    .insert({ job_surveyor_id: jobSurveyorId, ...e, created_by: user?.id ?? null }).select('id').single()
  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function deleteSurveyorOvertime(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_surveyor_overtime').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

// ── Per-surveyor REGULAR time-log (migration 157) ────────────────────────────
// The regular-hours twin of the overtime log above: for multi-day regular jobs a
// surveyor logs each shift (start date/time → stop date/time) and mig-157's
// sync_regular_hours trigger sums the entries into job_surveyors.regular_hours,
// exactly as the OT log drives overtime_hours. Same shape, so the UI reuses shiftHours.
export type RegularEntry = OvertimeEntry

export async function listSurveyorRegular(jobSurveyorId: string): Promise<RegularEntry[]> {
  const { data } = await createClient().from('job_surveyor_regular')
    .select('id, entry_date, start_time, end_date, end_time, hours, location, note')
    .eq('job_surveyor_id', jobSurveyorId)
    .order('entry_date', { ascending: true }).order('start_time', { ascending: true })
  return ((data ?? []) as any[]).map(r => ({ id: r.id, entry_date: r.entry_date, start_time: r.start_time, end_date: r.end_date, end_time: r.end_time, hours: Number(r.hours ?? 0), location: r.location, note: r.note }))
}

export async function addSurveyorRegular(jobSurveyorId: string, e: { entry_date: string | null; start_time: string | null; end_date: string | null; end_time: string | null; hours: number; location: string | null; note: string | null }): Promise<{ error?: string; id?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('job_surveyor_regular')
    .insert({ job_surveyor_id: jobSurveyorId, ...e, created_by: user?.id ?? null }).select('id').single()
  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function deleteSurveyorRegular(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_surveyor_regular').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

// ── Per-surveyor kilometre log (migration 116) ───────────────────────────────
// Each entry is one trip a surveyor drove to a job: a date + the distance (10–140 km,
// whole numbers) + an optional note. Surveyors log km on every job (all billing modes);
// the sum per job is the mileage that feeds a per_km invoice line.
export const KM_MIN = 10
export const KM_MAX = 140

export interface KmEntry {
  id: string
  trip_date: string | null
  km: number
  note: string | null
}

export async function listSurveyorKm(jobSurveyorId: string): Promise<KmEntry[]> {
  const { data } = await createClient().from('job_surveyor_km')
    .select('id, trip_date, km, note')
    .eq('job_surveyor_id', jobSurveyorId)
    .order('trip_date', { ascending: true }).order('created_at', { ascending: true })
  return ((data ?? []) as any[]).map(r => ({ id: r.id, trip_date: r.trip_date, km: Number(r.km ?? 0), note: r.note }))
}

export async function addSurveyorKm(jobSurveyorId: string, e: { trip_date: string | null; km: number; note: string | null }): Promise<{ error?: string; id?: string }> {
  if (!Number.isInteger(e.km) || e.km < KM_MIN || e.km > KM_MAX) {
    return { error: `Distance must be a whole number between ${KM_MIN} and ${KM_MAX} km.` }
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase.from('job_surveyor_km')
    .insert({ job_surveyor_id: jobSurveyorId, ...e, created_by: user?.id ?? null }).select('id').single()
  if (error) return { error: error.message }
  return { id: data?.id }
}

export async function deleteSurveyorKm(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('job_surveyor_km').delete().eq('id', id)
  return error ? { error: error.message } : {}
}

/** Admin only (trigger-enforced): set a surveyor's pay rates on a job. */
export async function updateJobSurveyorRates(rowId: string, jobId: string, rates: { pay_rate: number | null; overtime_rate: number | null; pay_currency: string }): Promise<{ error?: string }> {
  const { data, error } = await createClient().from('job_surveyors')
    .update({ pay_rate: rates.pay_rate, overtime_rate: rates.overtime_rate, pay_currency: rates.pay_currency }).eq('id', rowId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'That change was blocked — only an admin can set pay rates.' }
  await logActivity('job', jobId, 'rates:update')
  return {}
}

export async function addJobSurveyor(jobId: string, surveyorId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Upsert-ignore: the mig-124 auto-assign trigger may have already added this
  // surveyor (as the job's assignee) — treat "already on the job" as success.
  const { error } = await supabase.from('job_surveyors')
    .upsert({ job_id: jobId, surveyor_id: surveyorId, created_by: user?.id ?? null }, { onConflict: 'job_id,surveyor_id', ignoreDuplicates: true })
  if (error) return { error: error.message }
  await logActivity('job', jobId, 'surveyor:add', { surveyor_id: surveyorId })
  return {}
}

export async function removeJobSurveyor(rowId: string, jobId: string): Promise<{ error?: string }> {
  const { data, error } = await createClient().from('job_surveyors').delete().eq('id', rowId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'That change was blocked — you may not have permission to update this job.' }
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
  const path = `${jobId}/${crypto.randomUUID()}_${sanitizeStorageName(file.name)}`
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
  /** True when this job doesn't require a report — shows "N/A", never counted as
   *  "missing a report number" and skipped by the auto-numbering (migration 119). */
  report_not_required: boolean
  job_type: string | null
  job_stage: string | null
  cargo_type: string | null
  notes: string | null
  vessel_name: string | null
  title: string
  client_id: string | null
  client_name: string | null
  /** Curated palette keys for colour-coding (client + the job's template/"job type"). */
  client_color: string | null
  template_color: string | null
  template_name: string | null
  workflow_status: WorkflowStatus
  is_overtime: boolean
  billing_mode: 'overtime' | 'regular' | 'fixed'
  /** Unit of regular_hours/overtime_hours below (migration 148). Per job, so both
   *  quantities on this row are always in the same unit — but rows in the list are
   *  NOT, so anything that labels or totals them must read this. */
  labour_unit: 'hours' | 'days'
  scheduled_date: string | null
  end_date: string | null
  created_at: string
  surveyors: string[]
  regular_hours: number
  overtime_hours: number
  /** Total kilometres driven across all surveyors on the job (migration 116). */
  total_km: number
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
      .select('id, report_number, report_not_required, job_type, job_stage, cargo_type, notes, vessel_name, title, surveyor_name, client_id, workflow_status, is_overtime, billing_mode, labour_unit, scheduled_date, end_date, created_at, invoice_id, client:clients(name, color), template:checklist_templates(name, color)')
      .order('created_at', { ascending: false }),
    supabase.from('job_surveyors')
      .select('id, job_id, regular_hours, overtime_hours, surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name, display_title)'),
    supabase.from('invoices').select('id, job_id, invoice_number, status, total, currency'),
  ])

  // Sum km per job via the job_surveyor → job_surveyor_km chain (one flat query).
  const jsToJob = new Map<string, string>()
  for (const r of (js ?? []) as any[]) jsToJob.set(r.id, r.job_id)
  const kmByJob = new Map<string, number>()
  const jsIds = (js ?? []).map((r: any) => r.id)
  if (jsIds.length) {
    const { data: kmRows } = await supabase.from('job_surveyor_km').select('job_surveyor_id, km').in('job_surveyor_id', jsIds)
    for (const k of (kmRows ?? []) as any[]) {
      const jobId = jsToJob.get(k.job_surveyor_id); if (!jobId) continue
      kmByJob.set(jobId, (kmByJob.get(jobId) ?? 0) + Number(k.km ?? 0))
    }
  }

  const sMap = new Map<string, { names: string[]; reg: number; ot: number }>()
  for (const r of (js ?? []) as any[]) {
    let e = sMap.get(r.job_id); if (!e) { e = { names: [], reg: 0, ot: 0 }; sMap.set(r.job_id, e) }
    const n = r.surveyor?.full_name; if (n) e.names.push(n)
    e.reg += Number(r.regular_hours ?? 0); e.ot += Number(r.overtime_hours ?? 0)
  }
  // Two ways a job links to an invoice: legacy per-job (invoices.job_id) and the
  // consolidated stamp (jobs.invoice_id → invoices.id). Index by both.
  const iByJob = new Map<string, any>()
  const iById = new Map<string, any>()
  for (const inv of (invs ?? []) as any[]) {
    if (inv.id) iById.set(inv.id, inv)
    if (inv.job_id && !iByJob.has(inv.job_id)) iByJob.set(inv.job_id, inv)
  }

  return ((jobs ?? []) as any[]).map(j => {
    const s = sMap.get(j.id); const inv = iByJob.get(j.id) ?? (j.invoice_id ? iById.get(j.invoice_id) : null)
    // Prefer the multi-surveyor table; fall back to the legacy single name so
    // jobs assigned the old way still show their surveyor.
    const surveyors = s?.names.length ? s.names : (j.surveyor_name ? [j.surveyor_name] : [])
    return {
      id: j.id, report_number: j.report_number, report_not_required: !!j.report_not_required, job_type: j.job_type, job_stage: j.job_stage ?? null, cargo_type: j.cargo_type ?? null, notes: j.notes ?? null, vessel_name: j.vessel_name, title: j.title,
      client_id: j.client_id, client_name: j.client?.name ?? null,
      client_color: j.client?.color ?? null, template_color: j.template?.color ?? null, template_name: j.template?.name ?? null,
      workflow_status: j.workflow_status, is_overtime: !!j.is_overtime, billing_mode: (j.billing_mode ?? 'regular') as 'overtime' | 'regular' | 'fixed', labour_unit: (j.labour_unit === 'days' ? 'days' : 'hours') as 'hours' | 'days', scheduled_date: j.scheduled_date, end_date: j.end_date ?? null, created_at: j.created_at,
      surveyors, regular_hours: s?.reg ?? 0, overtime_hours: s?.ot ?? 0, total_km: kmByJob.get(j.id) ?? 0,
      invoice_number: inv?.invoice_number ?? null, invoice_status: inv?.status ?? null,
      invoice_total: inv ? Number(inv.total ?? 0) : null, invoice_currency: inv?.currency ?? null,
    }
  })
}

/** Inline edit of a single job field from the tracker grid. */
export async function updateJobField(jobId: string, patch: Record<string, any>): Promise<{ error?: string }> {
  // .select('id') so a 0-row RLS denial surfaces as an error instead of a silent
  // "saved" that reverts on reload.
  const { data, error } = await createClient().from('jobs').update(patch).eq('id', jobId).select('id')
  if (error) return { error: error.message }
  if (!data || data.length === 0) return { error: 'Edit was blocked — you may not have permission to update this job.' }
  return {}
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
  rows: { id: string; scheduled_date: string | null; created_at: string; report_number: string | null; report_not_required?: boolean }[],
  startSeq: number,
): Promise<{ error?: string; count: number }> {
  const supabase = createClient()
  const missing = rows
    .filter(r => !r.report_number && !r.report_not_required)
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
