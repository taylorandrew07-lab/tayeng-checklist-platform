import type { SupabaseClient } from '@supabase/supabase-js'
import { getDraft, putDraft, deleteDraft, getPhotosForJob, putPhoto, deletePhoto } from './db'
import { instanceKey, parseInstanceKey } from './instanceKeys'
import { findOrCreateVessel } from '@/lib/vessels/api'
import { createDraftJob } from '@/lib/jobs/drafts'

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
    // Route through the shared create seam so surveyor/offline jobs get the same
    // activity-log entry + provenance as every other create path. upsert:true keeps
    // it idempotent/retry-safe; notify:false because the surveyor assigns themselves.
    // client_job_permissions is handled inside createDraftJob.
    // This list is a WHITELIST, not a spread: a field the create form puts on the
    // draft but leaves out here is silently dropped on sync — the surveyor sees it
    // on their dashboard until the job publishes, then it's gone. Add both sides.
    //
    // jobs_set_report_number is BEFORE INSERT (mig 042), so it runs — and burns a
    // number off report_counters — before Postgres resolves ON CONFLICT. A flush
    // retried after a lost response would therefore leave a permanent gap in the
    // fiscal-year report sequence, so look first: if the row landed on an earlier
    // attempt, push only what the surveyor can have corrected since (the job page's
    // offline edit writes those back onto the draft) instead of re-upserting.
    const { data: alreadyCreated, error: preErr } = await supabase.from('jobs')
      .select('id, title, vessel_name, scheduled_date, port_location, notes').eq('id', jobId).maybeSingle()
    // A FAILED pre-check must NOT be read as "row doesn't exist" — that would drop us
    // into the else branch and re-run createDraftJob, whose BEFORE-INSERT trigger burns
    // a fresh report number off the counter even though the row already exists (the
    // upsert collapses to DO UPDATE and discards it), leaving a permanent gap in the
    // fiscal-year sequence. Treat a transient check failure as retryable instead.
    if (preErr) {
      await putDraft({ ...draft, syncError: preErr.message })
      return { ok: false, reason: 'error', message: preErr.message }
    }
    if (alreadyCreated) {
      // Only the columns that actually differ, so the ordinary retry writes nothing.
      const patch: Record<string, unknown> = {}
      if ((j.title ?? null) !== alreadyCreated.title) patch.title = j.title ?? null
      if ((j.vessel_name ?? null) !== alreadyCreated.vessel_name) { patch.vessel_name = j.vessel_name ?? null; patch.vessel_id = vesselId }
      if ((j.scheduled_date ?? null) !== alreadyCreated.scheduled_date) patch.scheduled_date = j.scheduled_date ?? null
      if ((j.port_location ?? null) !== alreadyCreated.port_location) patch.port_location = j.port_location ?? null
      if ((j.notes ?? null) !== alreadyCreated.notes) patch.notes = j.notes ?? null
      if (Object.keys(patch).length > 0) {
        const { error: updErr } = await supabase.from('jobs').update(patch).eq('id', jobId)
        if (updErr) {
          await putDraft({ ...draft, syncError: updErr.message })
          return { ok: false, reason: 'error', message: updErr.message }
        }
      }
      draft = { ...draft, pendingCreate: false }
      await putDraft(draft)
    } else {
      const created = await createDraftJob(supabase, {
        job: {
          id: jobId,
          title: j.title,
          template_id: j.template_id,
          job_type: j.job_type ?? null,
          job_stage: j.job_stage ?? null,
          cargo_type: j.cargo_type ?? null,
          port_location: j.port_location ?? null,
          vessel_name: j.vessel_name ?? null,
          vessel_id: vesselId,
          surveyor_name: j.surveyor_name ?? null,
          client_id: j.client_id ?? null,
          created_by: user.id,
          assigned_to: user.id,
          workflow_status: 'in_progress',
          // billing_mode + is_overtime move together (the jobs list reads is_overtime).
          // Defaults match the column defaults, so drafts saved before the surveyor form
          // offered billing mode publish exactly as they always did.
          billing_mode: j.billing_mode ?? 'regular',
          is_overtime: j.is_overtime ?? false,
          notes: j.notes ?? null,
          // Carry the report-only flag the surveyor page stamped (report-only templates
          // show N/A). Fall back to false; createDraftJob still applies the job_type rule.
          report_not_required: j.report_not_required ?? false,
          scheduled_date: j.scheduled_date ?? null,
          end_date: j.end_date ?? null,
          start_time: j.start_time ?? null,
          end_time: j.end_time ?? null,
          started_at: j.started_at ?? new Date().toISOString(),
        },
        // The mig-124 trigger mirrors assigned_to → job_surveyors for the owner;
        // these are the EXTRA co-surveyors the form picked (mig 150 lets a surveyor
        // attach them to their own open job). notify is best-effort and a no-op for a
        // non-admin session today (notify.ts), so co-surveyors just see the job on
        // their dashboard; the flag is ready for the future service-role seam.
        surveyorIds: (draft.surveyorIds ?? []).filter(id => id !== user.id),
        actorId: user.id,
        clientId: j.client_id ?? null,
        upsert: true,
        notify: true,
      }, 'manual')
      if (created.error) {
        await putDraft({ ...draft, syncError: created.error })
        return { ok: false, reason: 'error', message: created.error }
      }
      // The row now exists — clear the flag so later syncs treat it as a normal job.
      // created.permissionError (client status grant) is non-fatal for the same reason
      // as assignError below; with ignoreDuplicates it no longer even fires on retries.
      // created.assignError (a co-surveyor that RLS refused) is deliberately non-fatal
      // and not surfaced here: the job is the owner's and complete, the answers-sync
      // below would clear any syncError we set anyway, and an admin can add the missing
      // co-surveyor on the job page — same as the admin create path treats it.
      draft = { ...draft, pendingCreate: false }
      await putDraft(draft)
    }
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
