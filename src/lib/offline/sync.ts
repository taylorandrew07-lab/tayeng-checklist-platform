import type { SupabaseClient } from '@supabase/supabase-js'
import { getDraft, putDraft, deleteDraft, getPhotosForJob, putPhoto, deletePhoto } from './db'
import { instanceKey, parseInstanceKey } from './instanceKeys'
import { findOrCreateVessel } from '@/lib/vessels/api'

export type SyncResult =
  | { ok: true; submitted: boolean; nothing?: boolean }
  | { ok: false; reason: 'no-user' | 'wrong-user' | 'conflict' | 'error'; message: string }

function canon(
  v: Record<string, string>,
  a: Record<string, string[]>,
  s: Record<string, string>
): string {
  const pv = Object.keys(v).sort().map(k => `${k}=${v[k] ?? ''}`).join('|')
  const pa = Object.keys(a).sort().map(k => `${k}=${[...(a[k] ?? [])].sort().join(',')}`).join('|')
  const ps = Object.keys(s).sort().map(k => `${k}=${s[k] ?? ''}`).join('|')
  return `${pv}#${pa}#${ps}`
}

/**
 * Push a job's local draft to Supabase using the normal logged-in user client.
 * Idempotent and retry-safe. Refuses to overwrite if the job locked OR its
 * server-side answers changed since we cached them (concurrent edit), and never
 * clobbers edits made on the device while the sync was running (revision check).
 */
export async function syncDraft(supabase: SupabaseClient, jobId: string): Promise<SyncResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'no-user', message: 'You are signed out.' }

  let draft = await getDraft(user.id, jobId)
  if (!draft) return { ok: true, submitted: false, nothing: true }
  if (draft.userId !== user.id) return { ok: false, reason: 'wrong-user', message: 'This draft belongs to a different user.' }
  // An online-only local-cache draft has nothing to push — never publish it.
  if (!draft.needsSync && !draft.pendingSubmit && !draft.pendingCreate) return { ok: true, submitted: false, nothing: true }

  const rev = draft.updatedAt
  const wasPendingCreate = !!draft.pendingCreate

  if (wasPendingCreate) {
    // Job started offline: create the server row first. Idempotent on the client
    // UUID, so a retried/interrupted flush never duplicates it. RLS requires the
    // template's allow_surveyor_start — same as the online create path.
    const j: any = draft.job ?? {}
    // Link to the vessels directory (idempotent ilike match → create). We're online
    // here (this is the sync), so every synced job lands linked, not just admin ones.
    const vesselId = j.vessel_id ?? (j.vessel_name ? await findOrCreateVessel(j.vessel_name) : null)
    const { error: createErr } = await supabase.from('jobs').upsert({
      id: jobId,
      title: j.title,
      template_id: j.template_id,
      vessel_name: j.vessel_name ?? null,
      vessel_id: vesselId,
      surveyor_name: j.surveyor_name ?? null,
      client_id: j.client_id ?? null,
      created_by: user.id,
      assigned_to: user.id,
      workflow_status: 'in_progress',
      notes: j.notes ?? null,
      scheduled_date: j.scheduled_date ?? null,
      started_at: j.started_at ?? new Date().toISOString(),
    }, { onConflict: 'id' })
    if (createErr) {
      await putDraft({ ...draft, syncError: createErr.message })
      return { ok: false, reason: 'error', message: createErr.message }
    }
    // Mirror the online create: give the linked client visibility of their job.
    if (j.client_id) {
      await supabase.from('client_job_permissions').upsert(
        { client_id: j.client_id, job_id: jobId, can_view_status: true, can_view_pdf: false, can_view_checklist_details: false },
        { onConflict: 'client_id,job_id' }
      )
    }
    // The row now exists — clear the flag so later syncs treat it as a normal job.
    draft = { ...draft, pendingCreate: false }
    await putDraft(draft)
  } else {
    // Submitted-lock conflict: a job already submitted on the server is read-only.
    const { data: serverJob, error: jobErr } = await supabase.from('jobs').select('id, submitted_at').eq('id', jobId).single()
    if (jobErr || !serverJob) {
      const message = jobErr?.message ?? 'Job not found on the server.'
      await putDraft({ ...draft, syncError: message })
      return { ok: false, reason: 'error', message }
    }
    if (serverJob.submitted_at && (draft.needsSync || draft.pendingSubmit)) {
      const message = 'This job was already submitted on the server — your local changes were kept and not sent.'
      await putDraft({ ...draft, syncError: message })
      return { ok: false, reason: 'conflict', message }
    }

    // Concurrent-edit conflict: did the server answers change since we cached them?
    if (draft.needsSync || draft.pendingSubmit) {
      const [valsRes, sigsRes] = await Promise.all([
        supabase.from('job_field_values').select('field_id, instance, value, value_array').eq('job_id', jobId),
        supabase.from('job_signatures').select('field_id, instance, signature_data').eq('job_id', jobId),
      ])
      if (valsRes.error || sigsRes.error) {
        // Don't compare against an empty/failed read — that would false-conflict
        // or, worse, false-pass. Treat a failed check as a retryable error.
        const message = (valsRes.error || sigsRes.error)?.message ?? 'Could not verify the server state — will retry.'
        await putDraft({ ...draft, syncError: message })
        return { ok: false, reason: 'error', message }
      }
      const svVals = valsRes.data
      const svSigs = sigsRes.data
      // Key by instanceKey so this matches the draft's composite-keyed maps (repeatable
      // sections store one row per (field, instance)).
      const nowVals: Record<string, string> = {}
      const nowArr: Record<string, string[]> = {}
      for (const v of (svVals ?? [])) { const k = instanceKey(v.field_id, (v as any).instance ?? 0); if (v.value_array) nowArr[k] = v.value_array; else nowVals[k] = v.value ?? '' }
      const nowSigs: Record<string, string> = {}
      for (const s of (svSigs ?? [])) nowSigs[instanceKey(s.field_id, (s as any).instance ?? 0)] = s.signature_data
      if (canon(nowVals, nowArr, nowSigs) !== canon(draft.serverValues, draft.serverArrayValues, draft.serverSignatures)) {
        const message = 'This checklist was changed on the server since you went offline. Your local changes were kept and not sent — reload to merge.'
        await putDraft({ ...draft, syncError: message })
        return { ok: false, reason: 'conflict', message }
      }
    }
  }

  try {
    // Keys carry the repeatable-section instance — split it back out for persistence.
    const valueRows = Object.entries(draft.values).map(([key, value]) => {
      const { fieldId, instance } = parseInstanceKey(key)
      return { job_id: jobId, field_id: fieldId, instance, value, value_array: null }
    })
    const arrayRows = Object.entries(draft.arrayValues).map(([key, value_array]) => {
      const { fieldId, instance } = parseInstanceKey(key)
      return { job_id: jobId, field_id: fieldId, instance, value: null, value_array }
    })
    if (valueRows.length) {
      const { error } = await supabase.from('job_field_values').upsert(valueRows, { onConflict: 'job_id,field_id,instance' })
      if (error) throw error
    }
    if (arrayRows.length) {
      const { error } = await supabase.from('job_field_values').upsert(arrayRows, { onConflict: 'job_id,field_id,instance' })
      if (error) throw error
    }
    for (const [key, signature_data] of Object.entries(draft.signatures)) {
      if (!signature_data) continue
      const { fieldId, instance } = parseInstanceKey(key)
      const { error } = await supabase.from('job_signatures').upsert(
        { job_id: jobId, field_id: fieldId, instance, signature_data, signed_at: new Date().toISOString() },
        { onConflict: 'job_id,field_id,instance' }
      )
      if (error) throw error
    }

    // Repeatable-entry display order (migration 106), carried on the cached job.
    // Best-effort — a hiccup here must not block syncing the actual answers.
    const order = (draft.job as any)?.repeatable_order
    if (order && typeof order === 'object' && Object.keys(order).length) {
      try { await supabase.from('jobs').update({ repeatable_order: order }).eq('id', jobId) } catch { /* re-syncs next time */ }
    }

    // Queued photos (phase 2; no-op in phase 1). Idempotent via client_local_id.
    for (const p of await getPhotosForJob(user.id, jobId)) {
      if (p.uploaded) continue
      const path = p.storagePath ?? `${jobId}/${p.fieldId ?? 'general'}/${p.localId}_${p.filename}`
      const { error: upErr } = await supabase.storage.from('job-photos')
        .upload(path, p.blob, { contentType: 'image/jpeg', upsert: true })
      if (upErr) { await putPhoto({ ...p, storagePath: path, error: upErr.message }); throw upErr }
      const { error: rowErr } = await supabase.from('job_photos').upsert({
        job_id: jobId, field_id: p.fieldId, storage_path: path, filename: p.filename,
        uploaded_by: user.id, client_local_id: p.localId, captured_at: p.capturedAt,
        gps_lat: p.gpsLat, gps_lng: p.gpsLng, gps_accuracy_m: p.gpsAccuracyM, uploaded_offline: true,
      }, { onConflict: 'client_local_id' })
      if (rowErr) { await putPhoto({ ...p, storagePath: path, error: rowErr.message }); throw rowErr }
      await putPhoto({ ...p, storagePath: path, uploaded: true, error: null })
    }

    let submitted = false
    if (draft.pendingSubmit) {
      // If the surveyor edited during this sync, do NOT submit a stale version —
      // keep it queued so the newer edits sync and submit on the next attempt.
      const mid = await getDraft(user.id, jobId)
      if (mid && mid.updatedAt !== rev) {
        // The values were already written to the server above; advance the
        // baseline so the next sync doesn't false-conflict against our own write.
        await putDraft({
          ...mid,
          serverValues: draft.values,
          serverArrayValues: draft.arrayValues,
          serverSignatures: draft.signatures,
          lastSyncedAt: Date.now(),
          syncError: null,
        })
        return { ok: true, submitted: false }
      }
      const { data: updatedRows, error } = await supabase.from('jobs')
        .update({ submitted_at: new Date().toISOString(), workflow_status: 'report_ready' }).eq('id', jobId).select('id')
      if (error) throw error
      // RLS can filter the update to zero rows with no error (e.g. the submitter
      // isn't assigned to this job). Keep the draft + surface it rather than
      // silently reporting a successful submit.
      if (!updatedRows || updatedRows.length === 0) {
        const message = 'Saved, but could not submit — this job is not assigned to you. Ask an admin to assign you so it can be submitted.'
        await putDraft({ ...draft, syncError: message })
        return { ok: false, reason: 'conflict', message }
      }
      submitted = true
    }

    // Cleanup — only touch the draft if it hasn't been edited during this sync.
    for (const p of await getPhotosForJob(user.id, jobId)) if (p.uploaded) await deletePhoto(p.localId)
    const current = await getDraft(user.id, jobId)
    const unchanged = !!current && current.updatedAt === rev
    const baseline = { serverValues: draft.values, serverArrayValues: draft.arrayValues, serverSignatures: draft.signatures }
    if (submitted) {
      if (unchanged) await deleteDraft(user.id, jobId)
      // keep newer edits; submit already applied, but they still need syncing
      else if (current) await putDraft({ ...current, ...baseline, pendingSubmit: false, lastSyncedAt: Date.now(), syncError: null })
    } else if (current) {
      await putDraft({
        ...current, ...baseline,
        dirty: unchanged ? false : current.dirty,
        needsSync: unchanged ? false : current.needsSync, // clear only if nothing new
        lastSyncedAt: Date.now(), syncError: null,
      })
    }
    return { ok: true, submitted }
  } catch (err: any) {
    const message = err?.message ?? 'Sync failed — will retry.'
    const latest = await getDraft(user.id, jobId)
    if (latest) await putDraft({ ...latest, syncError: message })
    return { ok: false, reason: 'error', message }
  }
}
