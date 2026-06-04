import type { SupabaseClient } from '@supabase/supabase-js'
import { getDraft, putDraft, deleteDraft, getPhotosForJob, putPhoto, deletePhoto } from './db'

export type SyncResult =
  | { ok: true; submitted: boolean; nothing?: boolean }
  | { ok: false; reason: 'no-user' | 'wrong-user' | 'conflict' | 'error'; message: string }

const LOCKED = ['submitted', 'completed', 'client_visible', 'archived']

/**
 * Push a job's local draft to Supabase using the normal logged-in user client.
 * Idempotent and retry-safe: values/signatures upsert on (job_id, field_id),
 * photos upsert on client_local_id. The queued submit is applied only after all
 * data + photos have synced. Never bypasses RLS.
 */
export async function syncDraft(supabase: SupabaseClient, jobId: string): Promise<SyncResult> {
  const draft = await getDraft(jobId)
  if (!draft) return { ok: true, submitted: false, nothing: true }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'no-user', message: 'You are signed out.' }
  if (draft.userId !== user.id) {
    return { ok: false, reason: 'wrong-user', message: 'This draft belongs to a different user.' }
  }

  // Conflict check — refetch the live job before overwriting.
  const { data: serverJob, error: jobErr } = await supabase
    .from('jobs').select('id, status').eq('id', jobId).single()
  if (jobErr || !serverJob) {
    const message = jobErr?.message ?? 'Job not found on the server.'
    await putDraft({ ...draft, syncError: message })
    return { ok: false, reason: 'error', message }
  }
  if (LOCKED.includes(serverJob.status) && (draft.dirty || draft.pendingSubmit)) {
    const message = `This job is now "${serverJob.status}" on the server — your local changes were kept and not sent.`
    await putDraft({ ...draft, syncError: message })
    return { ok: false, reason: 'conflict', message }
  }

  try {
    // 1. Field values + multi-select arrays
    const valueRows = Object.entries(draft.values).map(([field_id, value]) => ({ job_id: jobId, field_id, value, value_array: null }))
    const arrayRows = Object.entries(draft.arrayValues).map(([field_id, value_array]) => ({ job_id: jobId, field_id, value: null, value_array }))
    if (valueRows.length) {
      const { error } = await supabase.from('job_field_values').upsert(valueRows, { onConflict: 'job_id,field_id' })
      if (error) throw error
    }
    if (arrayRows.length) {
      const { error } = await supabase.from('job_field_values').upsert(arrayRows, { onConflict: 'job_id,field_id' })
      if (error) throw error
    }

    // 2. Signatures
    for (const [field_id, signature_data] of Object.entries(draft.signatures)) {
      if (!signature_data) continue
      const { error } = await supabase.from('job_signatures').upsert(
        { job_id: jobId, field_id, signature_data, signed_at: new Date().toISOString() },
        { onConflict: 'job_id,field_id' }
      )
      if (error) throw error
    }

    // 3. Queued photos — upload, then upsert the row by client_local_id (idempotent)
    for (const p of await getPhotosForJob(jobId)) {
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

    // 4. Apply the queued submit only after all data + photos are in.
    let submitted = false
    if (draft.pendingSubmit) {
      const { error } = await supabase.from('jobs')
        .update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', jobId)
      if (error) throw error
      submitted = true
    }

    // Clean up synced photos; clear or remove the draft.
    for (const p of await getPhotosForJob(jobId)) if (p.uploaded) await deletePhoto(p.localId)
    if (submitted) {
      await deleteDraft(jobId)
    } else {
      await putDraft({ ...draft, dirty: false, lastSyncedAt: Date.now(), syncError: null })
    }
    return { ok: true, submitted }
  } catch (err: any) {
    const message = err?.message ?? 'Sync failed — will retry.'
    await putDraft({ ...draft, syncError: message })
    return { ok: false, reason: 'error', message }
  }
}
