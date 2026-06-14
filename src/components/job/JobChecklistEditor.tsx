'use client'

import {
  useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback,
} from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2, Save, Send, Download, Camera, X, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, AlertTriangle, Eye,
  Cloud, CloudOff, RefreshCw,
} from 'lucide-react'
import { formatDate, checkConditionalLogic, withTimeout, vesselPrefixForLabel, normalizeVesselName, isSurveyedVesselNameField } from '@/lib/utils'
import { dirtyState } from '@/lib/dirty-state'
import FieldRenderer from '@/components/job/FieldRenderer'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { confirmDialog } from '@/components/ui/confirm'
import type { TemplateField, TemplateSection, JobFieldValue, JobSignature, WorkflowStatus } from '@/lib/types/database'
import { advanceWorkflowTo, WORKFLOW } from '@/lib/jobs/tracker'
import { offlineAvailable, getDraft, putDraft, deleteDraft, requestPersistentStorage } from '@/lib/offline/db'
import { syncDraft } from '@/lib/offline/sync'
import type { OfflineDraft } from '@/lib/offline/types'

interface SectionWithFields extends TemplateSection {
  fields: TemplateField[]
}

export interface JobChecklistEditorHandle {
  isDirty: boolean
  save: () => Promise<boolean>
  navigate: (destination: string) => void
}

interface Props {
  jobId: string
  backHref: string
  /** Force the checklist into read-only mode regardless of job status. */
  forceReadOnly?: boolean
}

const JobChecklistEditor = forwardRef<JobChecklistEditorHandle, Props>(
  function JobChecklistEditor({ jobId, backHref, forceReadOnly = false }, ref) {
    const router = useRouter()

    const [job, setJob] = useState<any>(null)
    const [sections, setSections] = useState<SectionWithFields[]>([])
    const [values, setValues] = useState<Record<string, string>>({})
    const [arrayValues, setArrayValues] = useState<Record<string, string[]>>({})
    const [signatures, setSignatures] = useState<Record<string, string>>({})
    // fieldPhotos: photos linked to a specific field_id; generalPhotos: extras with no field_id
    const [fieldPhotos, setFieldPhotos] = useState<Record<string, any[]>>({})
    const [generalPhotos, setGeneralPhotos] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [isDirty, setIsDirty] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [lastSaved, setLastSaved] = useState<Date | null>(null)
    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
    const [showSubmitDialog, setShowSubmitDialog] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [showLeaveDialog, setShowLeaveDialog] = useState(false)
    const [leaveDestination, setLeaveDestination] = useState<string | null>(null)
    const [uploadingField, setUploadingField] = useState<string | null>(null)
    const [showPreview, setShowPreview] = useState(false)
    const [leaveError, setLeaveError] = useState<string | null>(null)
    // Identity & role for profile-based edit rights
    const [currentUserId, setCurrentUserId] = useState<string | null>(null)
    const [isPrivileged, setIsPrivileged] = useState(false) // admin or super_admin
    const [adminOverride, setAdminOverride] = useState(false) // "Edit as admin" engaged
    const [showOverrideDialog, setShowOverrideDialog] = useState(false)
    const [editSubmitted, setEditSubmitted] = useState(false) // admin re-opened a submitted/completed checklist
    const [showEditSubmittedDialog, setShowEditSubmittedDialog] = useState(false)
    const generalPhotoRef = useRef<HTMLInputElement>(null)
    const fieldPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({})
    // Offline state
    const [online, setOnline] = useState(true)
    const [syncStatus, setSyncStatus] = useState<'idle' | 'pending' | 'syncing' | 'synced' | 'error'>('idle')
    const [syncMessage, setSyncMessage] = useState<string | null>(null)
    const draftLoadedRef = useRef(false)
    const serverBaselineRef = useRef<{ values: Record<string, string>; arrayValues: Record<string, string[]>; signatures: Record<string, string> }>({ values: {}, arrayValues: {}, signatures: {} })
    const syncNowRef = useRef<() => void>(() => {})

    // Expose isDirty + save + navigate to parent via ref
    useImperativeHandle(ref, () => ({
      get isDirty() { return isDirty },
      save: handleSave,
      navigate: requestNavigate,
    }))

    // Sync isDirty to global dirty-state so sidebar links respect it
    useEffect(() => {
      dirtyState.set(isDirty)
      dirtyState.setHandler(isDirty ? requestNavigate : null)
    }, [isDirty]) // eslint-disable-line react-hooks/exhaustive-deps

    // Clear global dirty-state on unmount
    useEffect(() => {
      return () => { dirtyState.set(false); dirtyState.setHandler(null) }
    }, [])

    // Warn on browser close/refresh when dirty
    useEffect(() => {
      const handler = (e: BeforeUnloadEvent) => {
        if (isDirty) { e.preventDefault(); e.returnValue = '' }
      }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }, [isDirty])

    // Keep the latest syncNow in a ref so the reconnect listener (registered once)
    // always calls the current closure (with currentUserId populated).
    useEffect(() => { syncNowRef.current = syncNow })

    // Track connectivity; auto-sync the local draft when we come back online.
    useEffect(() => {
      if (!offlineAvailable()) return
      setOnline(navigator.onLine)
      const goOnline = () => { setOnline(true); void syncNowRef.current() }
      const goOffline = () => setOnline(false)
      window.addEventListener('online', goOnline)
      window.addEventListener('offline', goOffline)
      return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline) }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Persist the local draft (debounced) while editing an offline-eligible job.
    useEffect(() => {
      if (!draftLoadedRef.current || !offlineEditable() || !isDirty) return
      const t = setTimeout(() => {
        if (!draftLoadedRef.current) return // editor left / draft discarded
        persistDraft(false).catch(() => { /* best-effort autosave; explicit Save surfaces errors */ })
        if (typeof navigator !== 'undefined' && !navigator.onLine) setSyncStatus('pending')
      }, 700)
      return () => clearTimeout(t)
    }, [values, arrayValues, signatures, isDirty]) // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-clear the transient "synced" badge.
    useEffect(() => {
      if (syncStatus !== 'synced') return
      const t = setTimeout(() => setSyncStatus('idle'), 3000)
      return () => clearTimeout(t)
    }, [syncStatus])

    useEffect(() => { load() }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

    // --- Offline helpers ---
    function offlineEditable(): boolean {
      return offlineAvailable() && !forceReadOnly && !!job && !!currentUserId &&
        !job?.submitted_at
    }

    function hydrateFromDraft(draft: OfflineDraft) {
      setJob(draft.job)
      setSections(draft.sections)
      setValues(draft.values)
      setArrayValues(draft.arrayValues)
      setSignatures(draft.signatures)
      setFieldPhotos(draft.fieldPhotos ?? {})
      setGeneralPhotos(draft.generalPhotos ?? [])
      serverBaselineRef.current = {
        values: draft.serverValues ?? {},
        arrayValues: draft.serverArrayValues ?? {},
        signatures: draft.serverSignatures ?? {},
      }
      setIsDirty(draft.dirty)
      if (draft.needsSync || draft.pendingSubmit) setSyncStatus('pending')
    }

    // Persists the local draft. Throws on failure so explicit Save/Submit can
    // surface the error instead of falsely reporting success.
    async function persistDraft(pendingSubmit: boolean): Promise<void> {
      if (!offlineEditable() || !currentUserId) throw new Error('Offline saving is not available here.')
      const existing = await getDraft(currentUserId, jobId).catch(() => undefined)
      const offlineNow = typeof navigator !== 'undefined' && !navigator.onLine
      await putDraft({
        key: '', jobId, userId: currentUserId, job, sections, values, arrayValues, signatures,
        fieldPhotos, generalPhotos,
        serverValues: serverBaselineRef.current.values,
        serverArrayValues: serverBaselineRef.current.arrayValues,
        serverSignatures: serverBaselineRef.current.signatures,
        pendingSubmit: pendingSubmit || existing?.pendingSubmit || false,
        // Preserve "started offline, not yet on the server" across edits.
        pendingCreate: existing?.pendingCreate || false,
        dirty: true,
        // Only mark for server sync when the change was made offline (or queued
        // submit). Online autosaves are a local safety cache, not a push — except
        // a job that only exists locally, which must always sync to create itself.
        needsSync: offlineNow || pendingSubmit || existing?.pendingCreate || existing?.needsSync || false,
        updatedAt: Date.now(),
        lastSyncedAt: existing?.lastSyncedAt ?? null, syncError: existing?.syncError ?? null,
      })
    }

    async function markDraftSynced(
      v: Record<string, string> = values,
      a: Record<string, string[]> = arrayValues,
      s: Record<string, string> = signatures,
    ) {
      if (!offlineAvailable() || !currentUserId) return
      serverBaselineRef.current = { values: v, arrayValues: a, signatures: s }
      await putDraft({
        key: '', jobId, userId: currentUserId, job, sections, values: v, arrayValues: a, signatures: s,
        fieldPhotos, generalPhotos,
        serverValues: v, serverArrayValues: a, serverSignatures: s,
        pendingSubmit: false, dirty: false, needsSync: false, updatedAt: Date.now(),
        lastSyncedAt: Date.now(), syncError: null,
      }).catch(() => {})
      setSyncStatus('idle')
      setSyncMessage(null)
    }

    // Refresh the offline draft's cached photo metadata after an online photo
    // upload/delete, so an offline reopen sees current photos for validation.
    async function cacheServerPhotos(fp: Record<string, any[]>, gp: any[]) {
      if (!offlineAvailable() || !currentUserId) return
      const existing = await getDraft(currentUserId, jobId).catch(() => undefined)
      if (existing) await putDraft({ ...existing, fieldPhotos: fp, generalPhotos: gp }).catch(() => {})
    }

    async function syncNow() {
      if (!offlineAvailable() || typeof navigator === 'undefined' || !navigator.onLine || !currentUserId) return
      const existing = await getDraft(currentUserId, jobId).catch(() => null)
      if (!existing || (!existing.needsSync && !existing.pendingSubmit && !existing.pendingCreate)) return
      setSyncStatus('syncing'); setSyncMessage(null)
      const result = await syncDraft(createClient(), jobId)
      if (result.ok) {
        if (result.submitted) { setIsDirty(false); setSyncStatus('synced'); router.push(backHref); return }
        // Reflect post-sync draft state (edits made during sync stay dirty/pending).
        const after = await getDraft(currentUserId, jobId).catch(() => null)
        setIsDirty(!!after?.dirty)
        if (after) serverBaselineRef.current = { values: after.serverValues, arrayValues: after.serverArrayValues, signatures: after.serverSignatures }
        setSyncStatus(after && (after.needsSync || after.pendingSubmit) ? 'pending' : 'synced')
      } else {
        setSyncStatus('error'); setSyncMessage(result.message)
      }
    }

    async function discardDraft() {
      if (!(await confirmDialog({
        title: 'Discard local changes',
        message: 'Discard the changes saved on this device and reload from the server? Anything not yet synced will be lost.',
        danger: true, confirmLabel: 'Discard',
      }))) return
      if (currentUserId) await deleteDraft(currentUserId, jobId).catch(() => {})
      draftLoadedRef.current = false
      setSyncStatus('idle'); setSyncMessage(null)
      setLoading(true)
      await load()
    }

    async function load() {
      const supabase = createClient()
      const isOffline = offlineAvailable() && typeof navigator !== 'undefined' && !navigator.onLine

      // Identify the user. getUser() validates over the network, which fails
      // offline — so offline we trust only the locally-persisted session.
      let userId: string | null = null
      if (isOffline) {
        const { data: { session } } = await supabase.auth.getSession()
        userId = session?.user?.id ?? null
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        userId = user?.id ?? null
      }
      if (!userId) { router.push('/login'); return }
      setCurrentUserId(userId)

      // A job started offline lives only in the local draft until it syncs — the
      // server row may not exist yet, so load it from the draft regardless of
      // connectivity. Once synced, pendingCreate is cleared and normal load runs.
      const localCreate = await getDraft(userId, jobId).catch(() => undefined)
      if (localCreate && localCreate.userId === userId && localCreate.pendingCreate) {
        hydrateFromDraft(localCreate)
        setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
        draftLoadedRef.current = true
        setSyncStatus('pending')
        setLoading(false)
        return
      }

      // Offline: load from a saved local draft for this user if we have one.
      if (isOffline) {
        const draft = await getDraft(userId, jobId).catch(() => undefined)
        if (draft && draft.userId === userId) {
          hydrateFromDraft(draft)
          setOnline(false)
          draftLoadedRef.current = true
          setLoading(false)
          return
        }
        setSaveError('You are offline and this checklist isn’t saved on this device yet. Reconnect to load it.')
        setLoading(false)
        return
      }

      // Determine privilege (admin / super admin) for the "Edit as admin" override
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('role, is_super_admin')
        .eq('id', userId)
        .single()
      setIsPrivileged(profileRow?.role === 'admin' || profileRow?.is_super_admin === true)

      const [{ data: jobData }, { data: valData }, { data: sigData }, { data: photoData }] = await Promise.all([
        supabase.from('jobs').select(`
          *, template:checklist_templates(name, id), client:clients(name)
        `).eq('id', jobId).single(),
        supabase.from('job_field_values').select('*').eq('job_id', jobId),
        supabase.from('job_signatures').select('*').eq('job_id', jobId),
        supabase.from('job_photos').select('*').eq('job_id', jobId),
      ])

      if (!jobData) { router.push(backHref); return }

      const { data: tmplSections } = await supabase
        .from('template_sections')
        .select('*, fields:template_fields(*)')
        .eq('template_id', jobData.template_id)
        .order('order_index')

      const processedSections: SectionWithFields[] = (tmplSections ?? []).map((s: any) => ({
        ...s,
        fields: [...(s.fields ?? [])].sort((a: any, b: any) => a.order_index - b.order_index),
      }))

      const vals: Record<string, string> = {}
      const arrVals: Record<string, string[]> = {}
      for (const v of (valData ?? [])) {
        if (v.value_array) arrVals[v.field_id] = v.value_array
        else vals[v.field_id] = v.value ?? ''
      }
      for (const section of processedSections) {
        for (const field of section.fields) {
          // Auto-fill vessel/surveyor from job metadata (only if field is text and currently empty)
          if (field.field_type === 'text' && !vals[field.id]) {
            const lbl = field.label.toLowerCase()
            // Only the surveyed vessel's NAME field is auto-filled. This excludes
            // the separate "Bunker Vessel Name" and descriptor fields like
            // "Vessel IMO Number" / "Vessel Type" (see isSurveyedVesselNameField).
            if (isSurveyedVesselNameField(field.label) && jobData.vessel_name) {
              vals[field.id] = jobData.vessel_name
            } else if (lbl.includes('surveyor') && jobData.surveyor_name) {
              vals[field.id] = jobData.surveyor_name
            }
          }
          // Normalise vessel-name fields to canonical "M.V./M.T. Title Case"
          if (field.field_type === 'text' && vals[field.id]) {
            const prefix = vesselPrefixForLabel(field.label)
            if (prefix) vals[field.id] = normalizeVesselName(vals[field.id], prefix)
          }
        }
      }

      const sigs: Record<string, string> = {}
      for (const sig of (sigData ?? [])) sigs[sig.field_id] = sig.signature_data

      // Split photos by field_id
      const fPhotos: Record<string, any[]> = {}
      const gPhotos: any[] = []
      for (const p of (photoData ?? [])) {
        if (p.field_id) fPhotos[p.field_id] = [...(fPhotos[p.field_id] ?? []), p]
        else gPhotos.push(p)
      }

      setJob(jobData)
      setSections(processedSections)
      setValues(vals)
      setArrayValues(arrVals)
      setSignatures(sigs)
      setFieldPhotos(fPhotos)
      setGeneralPhotos(gPhotos)

      if (!jobData.started_at && !jobData.submitted_at) {
        await supabase.from('jobs').update({ started_at: new Date().toISOString() }).eq('id', jobId)
        // Move the unified workflow status forward as fieldwork starts.
        await advanceWorkflowTo(jobId, 'in_progress')
      }

      // Conflict baseline = what the server currently holds.
      serverBaselineRef.current = { values: vals, arrayValues: arrVals, signatures: sigs }

      // Offline cache: keep a clean snapshot for offline reopen, or restore a
      // newer unsynced local draft so unsynced field work is never lost.
      if (offlineAvailable()) {
        try {
          const draft = await getDraft(userId, jobId)
          if (draft && draft.userId === userId && (draft.needsSync || draft.pendingSubmit)) {
            hydrateFromDraft(draft)
          } else if (!jobData.submitted_at) {
            await putDraft({
              key: '', jobId, userId, job: jobData, sections: processedSections,
              values: vals, arrayValues: arrVals, signatures: sigs,
              fieldPhotos: fPhotos, generalPhotos: gPhotos,
              serverValues: vals, serverArrayValues: arrVals, serverSignatures: sigs,
              pendingSubmit: false, dirty: false, needsSync: false, updatedAt: Date.now(),
              lastSyncedAt: Date.now(), syncError: null,
            })
            await requestPersistentStorage()
          }
        } catch { /* offline cache is best-effort */ }
      }
      draftLoadedRef.current = true

      setLoading(false)
    }

    // --- Value setters that mark dirty ---
    const updateValue = useCallback((fieldId: string, val: string) => {
      setValues(prev => ({ ...prev, [fieldId]: val }))
      setIsDirty(true)
    }, [])

    // Calculated fields update values silently — they are derived, not user-driven
    const updateCalculatedValue = useCallback((fieldId: string, val: string) => {
      setValues(prev => ({ ...prev, [fieldId]: val }))
    }, [])

    const updateArrayValue = useCallback((fieldId: string, val: string[]) => {
      setArrayValues(prev => ({ ...prev, [fieldId]: val }))
      setIsDirty(true)
    }, [])

    const updateSignature = useCallback((fieldId: string, data: string) => {
      setSignatures(prev => ({ ...prev, [fieldId]: data }))
      setIsDirty(true)
    }, [])

    // --- Save (returns true on success) ---
    const handleSave = useCallback(async (): Promise<boolean> => {
      setSaving(true)
      setSaveError(null)

      // Offline: persist locally instead of calling Supabase.
      if (offlineAvailable() && typeof navigator !== 'undefined' && !navigator.onLine) {
        try {
          await persistDraft(false)
          setLastSaved(new Date())
          setIsDirty(false)
          setSyncStatus('pending')
          return true
        } catch (err: any) {
          setSaveError('Your changes are NOT saved — this device blocked local storage (' + (err?.message ?? 'unavailable') + '). Try again, or keep this page open and reconnect.')
          return false
        } finally {
          setSaving(false)
        }
      }

      const supabase = createClient()

      try {
        // Canonicalise vessel-name fields before saving (safety net in case the
        // input never fired its blur normaliser, e.g. clicking Save while focused).
        let valuesToSave = values
        const normalized: Record<string, string> = {}
        for (const section of sections) {
          for (const field of section.fields) {
            if (field.field_type !== 'text') continue
            const prefix = vesselPrefixForLabel(field.label)
            const current = values[field.id]
            if (!prefix || !current) continue
            const next = normalizeVesselName(current, prefix)
            if (next !== current) normalized[field.id] = next
          }
        }
        if (Object.keys(normalized).length > 0) {
          valuesToSave = { ...values, ...normalized }
          setValues(valuesToSave)
        }

        const upserts = Object.entries(valuesToSave).map(([field_id, value]) => ({
          job_id: jobId, field_id, value, value_array: null,
        }))
        const arrayUpserts = Object.entries(arrayValues).map(([field_id, value_array]) => ({
          job_id: jobId, field_id, value: null, value_array,
        }))

        if (upserts.length > 0) {
          const { error } = await withTimeout(
            supabase.from('job_field_values').upsert(upserts, { onConflict: 'job_id,field_id' }),
            15_000, 'Saving answers'
          )
          if (error) { console.error('[save:fieldValues]', error); throw error }
        }
        if (arrayUpserts.length > 0) {
          const { error } = await withTimeout(
            supabase.from('job_field_values').upsert(arrayUpserts, { onConflict: 'job_id,field_id' }),
            15_000, 'Saving multi-select answers'
          )
          if (error) { console.error('[save:arrayValues]', error); throw error }
        }
        for (const [field_id, signature_data] of Object.entries(signatures)) {
          if (!signature_data) continue
          const { error } = await withTimeout(
            supabase.from('job_signatures').upsert(
              { job_id: jobId, field_id, signature_data, signed_at: new Date().toISOString() },
              { onConflict: 'job_id,field_id' }
            ),
            10_000, 'Saving signature'
          )
          if (error) { console.error('[save:signatures]', error); throw error }
        }

        setLastSaved(new Date())
        setIsDirty(false)
        void markDraftSynced(valuesToSave)
        return true
      } catch (err: any) {
        setSaveError(err.message ?? 'Save failed — please try again')
        return false
      } finally {
        setSaving(false)
      }
    }, [jobId, values, arrayValues, signatures, sections]) // eslint-disable-line react-hooks/exhaustive-deps

    // --- Submit ---
    async function handleSubmit() {
      if (submitting) return

      setSubmitting(true)
      setSubmitError(null)
      setSaveError(null)

      try {
        // Validate required fields
        const missing: string[] = []
        for (const section of sections) {
          if (!checkConditionalLogic(section.conditional_logic, values)) continue
          for (const field of section.fields) {
            if (!field.is_required) continue
            if (!checkConditionalLogic(field.conditional_logic, values)) continue
            if (field.field_type === 'signature' && !signatures[field.id]) {
              missing.push(field.label)
            } else if (field.field_type === 'multiple_choice' && !(arrayValues[field.id]?.length)) {
              missing.push(field.label)
            } else if (field.field_type === 'photo' && !(fieldPhotos[field.id]?.length)) {
              missing.push(field.label)
            } else if (!['signature', 'multiple_choice', 'photo', 'heading', 'divider', 'calculated'].includes(field.field_type) && !values[field.id]) {
              missing.push(field.label)
            }
          }
        }

        if (missing.length > 0) {
          const message = `Required fields not completed: ${missing.join(', ')}`
          setSaveError(message)
          setSubmitError(message)
          return
        }

        // Offline: queue the submit locally; it is applied to the server on sync.
        if (offlineAvailable() && typeof navigator !== 'undefined' && !navigator.onLine) {
          await persistDraft(true)
          setIsDirty(false)
          setSyncStatus('pending')
          setShowSubmitDialog(false)
          router.push(backHref)
          return
        }

        const saved = await handleSave()
        if (!saved) {
          const message = 'The latest edits could not be saved, so the checklist was not submitted. Please try Save Draft first, then submit again.'
          setSubmitError(message)
          return
        }

        const supabase = createClient()
        const { data: updated, error } = await withTimeout(
          supabase.from('jobs').update({
            submitted_at: new Date().toISOString(),
          }).eq('id', jobId).select('id'),
          10_000, 'Submitting checklist'
        )

        if (error) {
          console.error('[submit:jobUpdate]', error)
          const message = 'Submit failed: ' + error.message
          setSaveError(message)
          setSubmitError(message)
          return
        }

        // A row-level policy can filter the update to zero rows with NO error —
        // which would otherwise look like a successful submit. Surface it.
        if (!updated || updated.length === 0) {
          console.error('[submit:jobUpdate] 0 rows updated for', jobId)
          const message = 'The checklist could not be submitted — your account may not have permission to update this job. Your answers are saved; please tell an admin so they can assign you or submit it.'
          setSaveError(message)
          setSubmitError(message)
          return
        }

        // Submitting the checklist means the report is ready for review.
        await advanceWorkflowTo(jobId, 'report_ready').catch(() => {})
        setShowSubmitDialog(false)
        if (currentUserId) await deleteDraft(currentUserId, jobId).catch(() => {})
        router.push(backHref)
      } catch (err: any) {
        const message = 'Submit failed: ' + (err.message ?? 'Unexpected error')
        setSaveError(message)
        setSubmitError(message)
      } finally {
        setSubmitting(false)
      }
    }

    // --- Navigation guard ---
    function requestNavigate(destination: string) {
      if (isDirty) {
        setLeaveDestination(destination)
        setShowLeaveDialog(true)
      } else {
        router.push(destination)
      }
    }

    async function confirmLeaveWithSave() {
      setLeaveError(null)
      const ok = await handleSave()
      if (ok) {
        setShowLeaveDialog(false)
        if (leaveDestination) router.push(leaveDestination)
      } else {
        // Keep dialog open; show the error that handleSave set in saveError
        setLeaveError(saveError ?? 'Save failed — please try again')
      }
    }

    async function confirmLeaveWithout() {
      setIsDirty(false)
      draftLoadedRef.current = false
      // Discard the local draft so explicitly-abandoned edits can't resurrect and
      // later overwrite the server on the next online load.
      if (currentUserId) await deleteDraft(currentUserId, jobId).catch(() => {})
      if (leaveDestination) router.push(leaveDestination)
      setShowLeaveDialog(false)
    }

    // --- Photo helpers ---
    async function uploadPhotoForField(fieldId: string, file: File) {
      setUploadingField(fieldId)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setUploadingField(null); return }

      const path = `${jobId}/${fieldId}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file)
      if (upErr) { setSaveError('Photo upload failed: ' + upErr.message); setUploadingField(null); return }

      const { error: dbErr } = await supabase.from('job_photos').insert({
        job_id: jobId, field_id: fieldId, storage_path: path,
        filename: file.name, uploaded_by: user.id,
      })
      if (dbErr) { setSaveError('Photo record failed: ' + dbErr.message); setUploadingField(null); return }

      const { data: fresh } = await supabase.from('job_photos').select('*').eq('job_id', jobId).eq('field_id', fieldId)
      const nextFp = { ...fieldPhotos, [fieldId]: fresh ?? [] }
      setFieldPhotos(nextFp)
      void cacheServerPhotos(nextFp, generalPhotos)
      setUploadingField(null)
    }

    async function uploadGeneralPhoto(file: File) {
      setUploadingField('general')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setUploadingField(null); return }

      const path = `${jobId}/general/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('job-photos').upload(path, file)
      if (upErr) { setSaveError('Photo upload failed: ' + upErr.message); setUploadingField(null); return }

      const { error: dbErr } = await supabase.from('job_photos').insert({
        job_id: jobId, field_id: null, storage_path: path,
        filename: file.name, uploaded_by: user.id,
      })
      if (dbErr) { setSaveError('Photo record failed: ' + dbErr.message); setUploadingField(null); return }

      const { data: fresh } = await supabase.from('job_photos').select('*').eq('job_id', jobId).is('field_id', null)
      const nextGp = fresh ?? []
      setGeneralPhotos(nextGp)
      void cacheServerPhotos(fieldPhotos, nextGp)
      setUploadingField(null)
    }

    async function deletePhoto(photoId: string, storagePath: string, fieldId?: string | null) {
      const supabase = createClient()
      const { error: storErr } = await supabase.storage.from('job-photos').remove([storagePath])
      if (storErr) { setSaveError('Delete failed: ' + storErr.message); return }
      const { error: dbErr } = await supabase.from('job_photos').delete().eq('id', photoId)
      if (dbErr) { setSaveError('Delete record failed: ' + dbErr.message); return }

      if (fieldId) {
        const nextFp = { ...fieldPhotos, [fieldId]: (fieldPhotos[fieldId] ?? []).filter(p => p.id !== photoId) }
        setFieldPhotos(nextFp)
        void cacheServerPhotos(nextFp, generalPhotos)
      } else {
        const nextGp = generalPhotos.filter(p => p.id !== photoId)
        setGeneralPhotos(nextGp)
        void cacheServerPhotos(fieldPhotos, nextGp)
      }
    }

    function toggleSection(id: string) {
      setCollapsedSections(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      )
    }

    if (!job) return null

    const isSubmitted = !!job.submitted_at

    // --- Profile-based edit rights ---
    // Rights are based on the real assigned/creator profile id, not the route or role.
    const isAssignedUser = !!currentUserId && job.assigned_to === currentUserId
    // Creator may edit only when the job is not assigned to a *different* real user
    const isCreatorUnassigned = !!currentUserId && job.created_by === currentUserId &&
      (job.assigned_to === null || job.assigned_to === currentUserId)
    const canEditByIdentity = isAssignedUser || isCreatorUnassigned

    // A privileged user (admin/super admin) who is NOT the assigned/creator can take
    // over editing via an explicit confirmed override. Submitted jobs stay locked for all.
    const canOverride = isPrivileged && !canEditByIdentity && !isSubmitted
    const editingDenied = !canEditByIdentity && !adminOverride

    // A privileged user can re-open a submitted/completed checklist to correct mistakes
    // via an explicit confirmed action. Saving preserves the job's current status (it is
    // NOT re-submitted), so e.g. a completed job stays completed.
    const adminEditingSubmitted = isPrivileged && isSubmitted && editSubmitted

    const readOnly = forceReadOnly || (
      isSubmitted ? !adminEditingSubmitted : editingDenied
    )

    // Flat list of all fields for token substitution
    const allFieldsFlat = sections.flatMap(s => s.fields)

    // Replace {uuid} tokens in field labels with the current selected value of that field.
    // Used for dynamic labels like "Manual sounding of {method_of_delivery_field_id}".
    function resolveLabel(label: string): string {
      return label.replace(/\{([0-9a-f-]{36})\}/gi, (_, fieldId) => {
        const raw = values[fieldId] ?? ''
        const val = raw.includes('|||') ? raw.split('|||')[0] : raw
        if (!val) return label.match(/\{[0-9a-f-]{36}\}/gi)?.length === 1 ? label : ''
        const srcField = allFieldsFlat.find(f => f.id === fieldId)
        if (srcField?.field_type === 'dropdown') {
          const opt = (srcField.options ?? []).find((o: any) => o.value === val)
          if (opt?.useFieldId) {
            const deferred = values[opt.useFieldId] ?? ''
            const text = deferred.includes('|||') ? deferred.split('|||')[0] : deferred
            return text || opt.label || val
          }
          return opt?.label ?? val
        }
        return val
      })
    }

    return (
      <div className="space-y-5 pb-10">
        {/* Top action bar */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="page-title truncate">{job.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-gray-500">{job.job_number}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${WORKFLOW[job.workflow_status as WorkflowStatus]?.pill ?? ''}`}>
                {WORKFLOW[job.workflow_status as WorkflowStatus]?.label ?? job.workflow_status}
              </span>
              {lastSaved && !isDirty && (
                <span className="text-xs text-gray-400">Saved {lastSaved.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {!readOnly && isDirty && (
              <span className="hidden sm:inline text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button onClick={() => setShowPreview(true)} className="btn-secondary">
              <Eye className="h-4 w-4" /><span className="hidden sm:inline">Preview</span>
            </button>
            {readOnly && canOverride && (
              <button onClick={() => setShowOverrideDialog(true)} className="btn-secondary text-amber-700 border-amber-300 hover:bg-amber-50">
                <AlertTriangle className="h-4 w-4" /><span className="hidden sm:inline">Edit as admin</span>
              </button>
            )}
            {isSubmitted && isPrivileged && !editSubmitted && !forceReadOnly && (
              <button onClick={() => setShowEditSubmittedDialog(true)} className="btn-secondary text-amber-700 border-amber-300 hover:bg-amber-50">
                <AlertTriangle className="h-4 w-4" /><span className="hidden sm:inline">Edit submitted</span>
              </button>
            )}
            {!readOnly && (
              <button onClick={handleSave} disabled={saving} className="btn-secondary">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                <span className="hidden sm:inline">{saving ? 'Saving…' : 'Save Draft'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Offline / sync status strip */}
        {offlineAvailable() && (!online || syncStatus !== 'idle') && (
          <div className={`rounded-lg border px-4 py-2.5 text-sm flex items-center gap-2 flex-wrap ${
            !online ? 'bg-amber-50 border-amber-200 text-amber-800'
              : syncStatus === 'error' ? 'bg-red-50 border-red-200 text-red-700'
              : syncStatus === 'syncing' ? 'bg-blue-50 border-blue-200 text-blue-700'
              : syncStatus === 'synced' ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-amber-50 border-amber-200 text-amber-800'
          }`}>
            {!online ? <CloudOff className="h-4 w-4 flex-shrink-0" />
              : syncStatus === 'syncing' ? <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
              : syncStatus === 'synced' ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              : <Cloud className="h-4 w-4 flex-shrink-0" />}
            <span className="flex-1 min-w-0">
              {!online ? 'Offline — your answers are saved on this device and will sync when you reconnect.'
                : syncStatus === 'syncing' ? 'Syncing your changes…'
                : syncStatus === 'synced' ? 'All changes synced.'
                : syncStatus === 'error' ? (syncMessage ?? 'Sync failed — will retry.')
                : 'Saved on this device — not yet synced to the server.'}
            </span>
            {online && (syncStatus === 'pending' || syncStatus === 'error') && (
              <button onClick={() => void syncNow()} className="btn-secondary py-1 px-2 text-xs">
                <RefreshCw className="h-3.5 w-3.5" />Sync now
              </button>
            )}
            {(syncStatus === 'pending' || syncStatus === 'error') && (
              <button onClick={() => void discardDraft()} className="text-xs underline opacity-70 hover:opacity-100">
                Discard local copy
              </button>
            )}
          </div>
        )}

        {/* Read-only notice for users who are not the assigned surveyor/creator */}
        {readOnly && !isSubmitted && editingDenied && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              This checklist is assigned to its surveyor and is read-only for you to avoid overwriting their work.
              {canOverride && ' Use “Edit as admin” to take over editing.'}
            </span>
          </div>
        )}
        {adminOverride && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>Admin override active — you are editing a checklist assigned to another surveyor. Changes will overwrite their working copy.</span>
          </div>
        )}
        {adminEditingSubmitted && (
          <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Admin edit mode — this checklist is already submitted. Use <strong>Save Draft</strong> to keep your corrections;
              it stays submitted and is not re-submitted.
            </span>
          </div>
        )}

        {/* Job info banner */}
        <div className="card p-4 bg-brand-50 border-brand-200">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs font-medium text-brand-600">Template</p>
              <p className="text-gray-900">{job.template?.name}</p>
            </div>
            {job.client && (
              <div>
                <p className="text-xs font-medium text-brand-600">Client</p>
                <p className="text-gray-900">{job.client.name}</p>
              </div>
            )}
            {job.surveyor_name && (
              <div>
                <p className="text-xs font-medium text-brand-600">Surveyor</p>
                <p className="text-gray-900">{job.surveyor_name}</p>
              </div>
            )}
            {job.vessel_name && (
              <div>
                <p className="text-xs font-medium text-brand-600">Vessel</p>
                <p className="text-gray-900">M.V. {job.vessel_name}</p>
              </div>
            )}
          </div>
        </div>

        {/* Submitted banner */}
        {isSubmitted && (
          <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 p-4">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">Checklist submitted</p>
              <p className="text-xs text-green-600">This checklist is read-only.</p>
            </div>
            <button
              onClick={() => window.open(`/api/pdf/${jobId}`, '_blank')}
              className="btn-secondary text-xs py-1.5 px-3"
            >
              <Download className="h-3.5 w-3.5" />PDF
            </button>
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-700">{saveError}</p>
            </div>
            <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Sections */}
        {sections.map(section => {
          if (!checkConditionalLogic(section.conditional_logic, values)) return null
          const collapsed = collapsedSections.has(section.id)
          const dataFields = section.fields.filter(f => !['heading', 'divider'].includes(f.field_type))
          const completedCount = dataFields.filter(f => {
            if (f.field_type === 'signature') return !!signatures[f.id]
            if (f.field_type === 'multiple_choice') return (arrayValues[f.id] ?? []).length > 0
            if (f.field_type === 'photo') return (fieldPhotos[f.id] ?? []).length > 0
            return !!values[f.id]
          }).length

          return (
            <div key={section.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 border-b border-gray-200 text-left hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-900">{section.title}</h2>
                  {section.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{completedCount}/{dataFields.length}</span>
                  {collapsed ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronUp className="h-4 w-4 text-gray-400" />}
                </div>
              </button>

              {!collapsed && (
                <div className="p-5 space-y-5">
                  {section.fields.map(field => {
                    // Photo fields get an inline upload widget
                    if (field.field_type === 'photo') {
                      const photos = fieldPhotos[field.id] ?? []
                      const uploading = uploadingField === field.id
                      return (
                        <div key={field.id} className="space-y-1.5">
                          <label className="label-base mb-0">
                            {field.item_number && <span className="text-brand-600 font-semibold mr-1.5">{field.item_number}</span>}
                            {field.label}
                            {field.is_required && <span className="text-red-500 ml-1">*</span>}
                          </label>
                          {field.help_text && <p className="text-xs text-gray-500">{field.help_text}</p>}
                          {!readOnly && (
                            <div className="space-y-2">
                              <input
                                ref={el => { fieldPhotoRefs.current[field.id] = el }}
                                type="file"
                                accept="image/*"
                                multiple
                                className="hidden"
                                onChange={async e => {
                                  const files = e.target.files
                                  if (!files) return
                                  for (const f of Array.from(files)) await uploadPhotoForField(field.id, f)
                                  if (fieldPhotoRefs.current[field.id]) fieldPhotoRefs.current[field.id]!.value = ''
                                }}
                              />
                              {photos.length === 0 ? (
                                <div
                                  onClick={() => !uploading && fieldPhotoRefs.current[field.id]?.click()}
                                  className="border-2 border-dashed border-gray-300 rounded-lg py-6 text-center cursor-pointer hover:border-brand-300 transition-colors"
                                >
                                  {uploading ? <Loader2 className="h-6 w-6 mx-auto text-brand-400 animate-spin" /> : (
                                    <>
                                      <Camera className="h-6 w-6 mx-auto text-gray-300 mb-1" />
                                      <p className="text-sm text-gray-500">Upload photo(s)</p>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                    {photos.map(p => (
                                      <div key={p.id} className="relative aspect-square rounded-lg bg-gray-100 flex items-center justify-center group overflow-hidden">
                                        <span className="text-xs text-gray-500 p-1 text-center break-all">{p.filename}</span>
                                        <button
                                          onClick={() => deletePhoto(p.id, p.storage_path, field.id)}
                                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                          <X className="h-3 w-3" />
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      onClick={() => fieldPhotoRefs.current[field.id]?.click()}
                                      disabled={uploading}
                                      className="aspect-square rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center hover:border-brand-300 transition-colors"
                                    >
                                      {uploading ? <Loader2 className="h-4 w-4 animate-spin text-brand-400" /> : <Camera className="h-4 w-4 text-gray-400" />}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {readOnly && (
                            <p className="text-sm text-gray-600">{photos.length} photo{photos.length !== 1 ? 's' : ''} uploaded</p>
                          )}
                        </div>
                      )
                    }

                    return (
                      <FieldRenderer
                        key={field.id}
                        field={field}
                        resolvedLabel={resolveLabel(field.label)}
                        value={values[field.id] ?? ''}
                        valueArray={arrayValues[field.id]}
                        signature={signatures[field.id]}
                        allValues={values}
                        onChange={field.field_type === 'calculated' ? v => updateCalculatedValue(field.id, v) : v => updateValue(field.id, v)}
                        onArrayChange={v => updateArrayValue(field.id, v)}
                        onSignatureChange={data => updateSignature(field.id, data)}
                        onBlur={v => {
                          const prefix = vesselPrefixForLabel(field.label)
                          if (!prefix) return
                          const next = normalizeVesselName(v, prefix)
                          if (next !== v) updateValue(field.id, next)
                        }}
                        readOnly={readOnly}
                      />
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

        {/* General (extra) photos section */}
        {!readOnly && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="section-title">Additional Photos</h2>
                <p className="text-xs text-gray-500 mt-0.5">Extra photos not tied to a specific field</p>
              </div>
              <button
                onClick={() => generalPhotoRef.current?.click()}
                disabled={uploadingField === 'general'}
                className="btn-secondary text-sm"
              >
                {uploadingField === 'general' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                Upload
              </button>
              <input
                ref={generalPhotoRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async e => {
                  const files = e.target.files
                  if (!files) return
                  for (const f of Array.from(files)) await uploadGeneralPhoto(f)
                  if (generalPhotoRef.current) generalPhotoRef.current.value = ''
                }}
              />
            </div>
            {generalPhotos.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                {generalPhotos.map(p => (
                  <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group">
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 p-1 text-center break-all">{p.filename}</div>
                    <button
                      onClick={() => deletePhoto(p.id, p.storage_path, null)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div
                onClick={() => generalPhotoRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg py-6 text-center cursor-pointer hover:border-brand-300 transition-colors"
              >
                <Camera className="h-7 w-7 mx-auto text-gray-300 mb-1" />
                <p className="text-sm text-gray-500">Upload additional photos</p>
              </div>
            )}
          </div>
        )}

        {/* Sticky bottom action bar */}
        {!readOnly && (
          <div className="sticky bottom-4 z-10">
            <div className="card p-3 flex items-center justify-between shadow-lg gap-3">
              <div className="min-w-0">
                {saveError ? (
                  <p className="text-xs text-red-600 truncate">{saveError}</p>
                ) : lastSaved ? (
                  <p className="text-xs text-gray-500">Saved {lastSaved.toLocaleTimeString()}</p>
                ) : isDirty ? (
                  <p className="text-xs text-amber-600">Unsaved changes</p>
                ) : null}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={handleSave} disabled={saving} className="btn-secondary">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                {!isSubmitted && (
                  <button
                    onClick={() => { setSubmitError(null); setShowSubmitDialog(true) }}
                    disabled={saving || submitting}
                    className="btn-primary"
                  >
                    <Send className="h-4 w-4" />Submit
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {readOnly && (
          <div className="flex justify-end">
            <button onClick={() => window.open(`/api/pdf/${jobId}`, '_blank')} className="btn-primary">
              <Download className="h-4 w-4" />Download PDF
            </button>
          </div>
        )}

        {/* Submit confirmation */}
        <ConfirmDialog
          open={showSubmitDialog}
          onClose={() => { if (!submitting) setShowSubmitDialog(false) }}
          onConfirm={handleSubmit}
          title="Submit Checklist"
          message={isDirty
            ? 'You have unsaved changes. The app will save your latest answers first, then submit the checklist. Once submitted you will not be able to edit it.'
            : 'Once submitted you will not be able to edit the checklist. Make sure all required fields are completed.'
          }
          confirmLabel={isDirty ? 'Save and Submit' : 'Submit Checklist'}
          loading={submitting}
          error={submitError}
        />

        {/* Admin override confirmation */}
        <ConfirmDialog
          open={showOverrideDialog}
          onClose={() => setShowOverrideDialog(false)}
          onConfirm={() => { setAdminOverride(true); setShowOverrideDialog(false) }}
          title="Take over editing?"
          message="This checklist is assigned to another surveyor. Editing it as an admin may overwrite their working copy. Only continue if you intend to take over this checklist."
          confirmLabel="Edit as admin"
          danger
        />

        {/* Edit-submitted-checklist confirmation (admin only) */}
        <ConfirmDialog
          open={showEditSubmittedDialog}
          onClose={() => setShowEditSubmittedDialog(false)}
          onConfirm={() => { setEditSubmitted(true); setShowEditSubmittedDialog(false) }}
          title="Edit submitted checklist?"
          message="This checklist has already been submitted. As an admin you can correct its answers — use Save Draft to store your changes. The checklist keeps its current status and is not re-submitted."
          confirmLabel="Edit checklist"
          danger
        />

        {/* Leave-with-unsaved-changes dialog */}
        {showLeaveDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">Unsaved changes</h3>
                  <p className="text-sm text-gray-500 mt-1">You have unsaved changes. What would you like to do?</p>
                </div>
              </div>
              {leaveError && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">{leaveError}</div>
              )}
              <div className="flex flex-col gap-2">
                <button
                  onClick={confirmLeaveWithSave}
                  disabled={saving}
                  className="btn-primary justify-center"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save and leave'}
                </button>
                <button onClick={confirmLeaveWithout} className="btn-secondary justify-center text-red-600 hover:bg-red-50 border-red-200">
                  Leave without saving
                </button>
                <button onClick={() => { setShowLeaveDialog(false); setLeaveError(null) }} className="btn-ghost justify-center">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preview modal — read-only formatted view of all current answers */}
        {showPreview && (
          <div className="fixed inset-0 z-50 bg-black/50 overflow-y-auto">
            <div className="max-w-3xl mx-auto my-8 px-4 pb-8">
              <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 bg-gray-50 border-b border-gray-200">
                  <div>
                    <h2 className="font-semibold text-gray-900">{job.title}</h2>
                    <p className="text-xs text-gray-500 mt-0.5">{job.job_number} · Preview (read-only)</p>
                  </div>
                  <button onClick={() => setShowPreview(false)} className="btn-ghost py-1.5 px-3">
                    <X className="h-4 w-4" />Close
                  </button>
                </div>
                <div className="p-6 space-y-5">
                  {sections.map(section => {
                    if (!checkConditionalLogic(section.conditional_logic, values)) return null
                    return (
                      <div key={section.id} className="card overflow-hidden">
                        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                          <h3 className="font-semibold text-gray-900">{section.title}</h3>
                          {section.description && <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>}
                        </div>
                        <div className="p-5 space-y-4">
                          {section.fields.map(field => {
                            if (!checkConditionalLogic(field.conditional_logic, values)) return null
                            if (field.field_type === 'photo') {
                              const count = (fieldPhotos[field.id] ?? []).length
                              return (
                                <div key={field.id} className="space-y-1">
                                  <p className="text-xs font-medium text-gray-500">
                                    {field.item_number && <span className="text-brand-600 font-semibold mr-1.5">{field.item_number}</span>}
                                    {resolveLabel(field.label)}
                                  </p>
                                  <p className="text-sm text-gray-700">{count} photo{count !== 1 ? 's' : ''} uploaded</p>
                                </div>
                              )
                            }
                            return (
                              <FieldRenderer
                                key={field.id}
                                field={field}
                                resolvedLabel={resolveLabel(field.label)}
                                value={values[field.id] ?? ''}
                                valueArray={arrayValues[field.id]}
                                signature={signatures[field.id]}
                                allValues={values}
                                onChange={() => {}}
                                readOnly
                              />
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
)

export default JobChecklistEditor
