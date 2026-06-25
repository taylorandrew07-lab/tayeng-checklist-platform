'use client'

import {
  useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback,
} from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2, Save, Send, Download, Camera, X, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, AlertTriangle, Eye,
  Cloud, CloudOff, RefreshCw, Plus,
} from 'lucide-react'
import { formatDate, checkConditionalLogic, withTimeout, vesselPrefixForLabel, normalizeVesselName, isSurveyedVesselNameField, evaluateCalculation } from '@/lib/utils'
import { dirtyState } from '@/lib/dirty-state'
import FieldRenderer from '@/components/job/FieldRenderer'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import { deliverJobPdf, isMobileDevice, openJobPdfInBrowser } from '@/lib/pdf/deliver'
import type { TemplateField, TemplateSection, JobFieldValue, JobSignature, WorkflowStatus } from '@/lib/types/database'
import { advanceWorkflowTo, WORKFLOW } from '@/lib/jobs/tracker'
import { offlineAvailable, getDraft, putDraft, deleteDraft, requestPersistentStorage } from '@/lib/offline/db'
import { syncDraft } from '@/lib/offline/sync'
import { instanceKey, parseInstanceKey } from '@/lib/offline/instanceKeys'
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
  /** Hide the editor's own "Download PDF" buttons when the page already shows one
   *  in its header (e.g. the admin job page) — avoids duplicate download buttons. */
  hideInlinePdf?: boolean
}

type SubmitOutcome = 'ok' | 'denied' | 'failed'

/**
 * Mark a job submitted, resiliently. Setting `submitted_at` is a tiny, idempotent
 * write, so on flaky field wifi we RETRY it and, after any error/timeout, VERIFY by
 * re-reading `submitted_at` — because the write often lands even when the response is
 * lost. This is the core reliability fix: a surveyor on a weak connection can no
 * longer end up with a fully-filled checklist that silently never submitted.
 *  - 'ok'     → submitted (this call, a prior attempt, or already submitted)
 *  - 'denied' → 0 rows AND not submitted → genuine RLS/permission denial
 *  - 'failed' → couldn't reach the server after retries (answers are safe; retry)
 */
async function submitJobWithRetry(jobId: string): Promise<SubmitOutcome> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const supabase = createClient()
    try {
      const { data, error } = await withTimeout(
        supabase.from('jobs').update({ submitted_at: new Date().toISOString() }).eq('id', jobId).select('id'),
        20_000, 'Submitting checklist'
      )
      if (!error && data && data.length > 0) return 'ok'
      if (!error && data && data.length === 0) {
        // 0 rows: either a real RLS denial or it's already submitted — verify.
        const { data: chk } = await supabase.from('jobs').select('submitted_at').eq('id', jobId).maybeSingle()
        return chk?.submitted_at ? 'ok' : 'denied'
      }
      // An error fell through — the write may still have landed; verify below.
    } catch { /* network/timeout — verify below, then retry */ }

    try {
      const { data: chk } = await createClient().from('jobs').select('submitted_at').eq('id', jobId).maybeSingle()
      if (chk?.submitted_at) return 'ok'
    } catch { /* couldn't verify either — retry */ }

    if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500))
  }
  return 'failed'
}

const JobChecklistEditor = forwardRef<JobChecklistEditorHandle, Props>(
  function JobChecklistEditor({ jobId, backHref, forceReadOnly = false, hideInlinePdf = false }, ref) {
    const router = useRouter()

    const [job, setJob] = useState<any>(null)
    const [sections, setSections] = useState<SectionWithFields[]>([])
    const [values, setValues] = useState<Record<string, string>>({})
    const [arrayValues, setArrayValues] = useState<Record<string, string[]>>({})
    const [signatures, setSignatures] = useState<Record<string, string>>({})
    // How many entries each repeatable section currently shows (sectionId → count ≥ 1).
    const [instanceCounts, setInstanceCounts] = useState<Record<string, number>>({})
    // fieldPhotos: photos keyed by instanceKey(field_id, instance); generalPhotos: extras with no field_id
    const [fieldPhotos, setFieldPhotos] = useState<Record<string, any[]>>({})
    const [generalPhotos, setGeneralPhotos] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [sharing, setSharing] = useState(false)

    // Get the report onto the device. Mobile opens the PDF endpoint in a new tab (the
    // native viewer handles save/share — no Web-Share-API hang); desktop downloads.
    async function downloadPdf() {
      if (isMobileDevice()) { openJobPdfInBrowser(jobId); return }
      setSharing(true)
      try {
        await deliverJobPdf(jobId)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not download the report.')
      } finally {
        setSharing(false)
      }
    }
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

    // Auto-save to the SERVER (debounced) so changes persist WITHOUT pressing Save —
    // 2s after you stop editing. Online only; offline edits stay in the local draft
    // above and push on reconnect. handleSave clears isDirty, so this won't loop, and
    // upserts are idempotent so a rare overlap with a manual Save is harmless. The
    // "Save Draft" button stays as a manual flush; a failed auto-save still surfaces
    // its error and the local draft keeps the data.
    useEffect(() => {
      if (!isDirty || readOnly || saving) return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      const t = setTimeout(() => {
        if (!isDirty || saving) return
        handleSave().catch(() => { /* local draft holds the data; saveError shows in the UI */ })
      }, 2000)
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
      // Rebuild repeatable entry counts from the draft's instance keys, so a draft
      // edited offline reopens with all its entries (not just the server's).
      const maxByField: Record<string, number> = {}
      for (const map of [draft.values, draft.arrayValues, draft.signatures, draft.fieldPhotos ?? {}] as Record<string, any>[]) {
        for (const k of Object.keys(map)) {
          const { fieldId, instance } = parseInstanceKey(k)
          if (instance > (maxByField[fieldId] ?? 0)) maxByField[fieldId] = instance
        }
      }
      const counts: Record<string, number> = {}
      for (const s of (draft.sections ?? []) as any[]) {
        if (!s.is_repeatable) continue
        let m = 0
        for (const f of (s.fields ?? [])) m = Math.max(m, maxByField[f.id] ?? 0)
        counts[s.id] = m + 1
      }
      setInstanceCounts(counts)
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
      // For repeatable sections: the highest instance seen for each field, so we know
      // how many entry blocks to render. instance 0 is the bare field id (unchanged).
      const maxInstanceByField: Record<string, number> = {}
      const noteInstance = (fieldId: string, inst: number) => {
        if (inst > (maxInstanceByField[fieldId] ?? 0)) maxInstanceByField[fieldId] = inst
      }
      for (const v of (valData ?? [])) {
        const inst = (v as any).instance ?? 0
        const key = instanceKey(v.field_id, inst)
        if (v.value_array) arrVals[key] = v.value_array
        else vals[key] = v.value ?? ''
        noteInstance(v.field_id, inst)
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
      for (const sig of (sigData ?? [])) {
        const inst = (sig as any).instance ?? 0
        sigs[instanceKey(sig.field_id, inst)] = sig.signature_data
        noteInstance(sig.field_id, inst)
      }

      // Split photos by field (keyed per instance); field-less ones are "general".
      const fPhotos: Record<string, any[]> = {}
      const gPhotos: any[] = []
      for (const p of (photoData ?? [])) {
        if (p.field_id) {
          const inst = (p as any).instance ?? 0
          const key = instanceKey(p.field_id, inst)
          fPhotos[key] = [...(fPhotos[key] ?? []), p]
          noteInstance(p.field_id, inst)
        } else gPhotos.push(p)
      }

      // How many entry blocks each repeatable section starts with (≥ 1).
      const counts: Record<string, number> = {}
      for (const section of processedSections) {
        if (!section.is_repeatable) continue
        let maxInst = 0
        for (const f of section.fields) maxInst = Math.max(maxInst, maxInstanceByField[f.id] ?? 0)
        counts[section.id] = maxInst + 1
      }

      setJob(jobData)
      setSections(processedSections)
      setValues(vals)
      setArrayValues(arrVals)
      setSignatures(sigs)
      setInstanceCounts(counts)
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

    // --- Repeatable-section entries ---
    const addInstance = useCallback((sectionId: string) => {
      setInstanceCounts(prev => ({ ...prev, [sectionId]: (prev[sectionId] ?? 1) + 1 }))
      setIsDirty(true)
    }, [])

    // Remove the LAST entry of a repeatable section: delete its saved rows/photos and
    // drop its in-memory keys. Only the last entry is removable, so no renumbering.
    const removeLastInstance = useCallback(async (section: SectionWithFields) => {
      const count = instanceCounts[section.id] ?? 1
      if (count <= 1) return
      const inst = count - 1
      const fieldIds = section.fields.map(f => f.id)
      const online = typeof navigator === 'undefined' || navigator.onLine
      if (online && fieldIds.length) {
        const supabase = createClient()
        try {
          await supabase.from('job_field_values').delete().eq('job_id', jobId).in('field_id', fieldIds).eq('instance', inst)
          await supabase.from('job_signatures').delete().eq('job_id', jobId).in('field_id', fieldIds).eq('instance', inst)
          const { data: ph } = await supabase.from('job_photos').select('id, storage_path').eq('job_id', jobId).in('field_id', fieldIds).eq('instance', inst)
          if (ph && ph.length) {
            await supabase.storage.from('job-photos').remove(ph.map((p: any) => p.storage_path))
            await supabase.from('job_photos').delete().in('id', ph.map((p: any) => p.id))
          }
        } catch { /* best effort — the in-memory keys are cleared regardless */ }
      }
      const drop = (obj: Record<string, any>) => {
        const next = { ...obj }
        for (const f of section.fields) delete next[instanceKey(f.id, inst)]
        return next
      }
      setValues(prev => drop(prev))
      setArrayValues(prev => drop(prev))
      setSignatures(prev => drop(prev))
      setFieldPhotos(prev => drop(prev))
      setInstanceCounts(prev => ({ ...prev, [section.id]: count - 1 }))
      setIsDirty(true)
    }, [instanceCounts, jobId])

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

        // Recompute calculated fields from the final values so their results are
        // ALWAYS persisted. (A calc updates via an effect after its inputs change
        // and deliberately doesn't mark the form dirty, so without this a result
        // computed after the last autosave could be saved empty — e.g. a blank
        // "Difference" even though the figures are filled.)
        const computed: Record<string, string> = {}
        for (const section of sections) {
          for (const field of section.fields) {
            if (field.field_type !== 'calculated' || !field.calculation_formula) continue
            const result = evaluateCalculation(field.calculation_formula, valuesToSave)
            if (result !== (valuesToSave[field.id] ?? '')) computed[field.id] = result
          }
        }
        if (Object.keys(computed).length > 0) {
          valuesToSave = { ...valuesToSave, ...computed }
          setValues(valuesToSave)
        }

        // Keys carry the repeatable-section instance (fieldId@@n); split it back out
        // so each entry persists against (job_id, field_id, instance).
        const upserts = Object.entries(valuesToSave).map(([key, value]) => {
          const { fieldId, instance } = parseInstanceKey(key)
          return { job_id: jobId, field_id: fieldId, instance, value, value_array: null }
        })
        const arrayUpserts = Object.entries(arrayValues).map(([key, value_array]) => {
          const { fieldId, instance } = parseInstanceKey(key)
          return { job_id: jobId, field_id: fieldId, instance, value: null, value_array }
        })

        if (upserts.length > 0) {
          const { error } = await withTimeout(
            supabase.from('job_field_values').upsert(upserts, { onConflict: 'job_id,field_id,instance' }),
            15_000, 'Saving answers'
          )
          if (error) { console.error('[save:fieldValues]', error); throw error }
        }
        if (arrayUpserts.length > 0) {
          const { error } = await withTimeout(
            supabase.from('job_field_values').upsert(arrayUpserts, { onConflict: 'job_id,field_id,instance' }),
            15_000, 'Saving multi-select answers'
          )
          if (error) { console.error('[save:arrayValues]', error); throw error }
        }
        for (const [key, signature_data] of Object.entries(signatures)) {
          if (!signature_data) continue
          const { fieldId, instance } = parseInstanceKey(key)
          const { error } = await withTimeout(
            supabase.from('job_signatures').upsert(
              { job_id: jobId, field_id: fieldId, instance, signature_data, signed_at: new Date().toISOString() },
              { onConflict: 'job_id,field_id,instance' }
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

    // Date the job by the SURVEY date the surveyor entered (the first answered
    // date field), not the day the job was created. Updates scheduled_date (drives
    // the jobs-list Date column, sorting + the calendar) and swaps the trailing
    // DD-MM-YYYY in the auto-generated title. No-op if no date field is filled.
    async function syncJobDateFromChecklist() {
      let surveyDate: string | null = null
      outer: for (const s of sections) {
        for (const f of s.fields) {
          if (f.field_type === 'date' && values[f.id]) { surveyDate = values[f.id]; break outer }
        }
      }
      if (!surveyDate || !/^\d{4}-\d{2}-\d{2}$/.test(surveyDate)) return
      const [yy, mm, dd] = surveyDate.split('-')
      const patch: Record<string, any> = { scheduled_date: surveyDate }
      if (job?.title) {
        const retitled = job.title.replace(/\d{2}-\d{2}-\d{4}\s*$/, `${dd}-${mm}-${yy}`)
        if (retitled !== job.title) patch.title = retitled
      }
      await createClient().from('jobs').update(patch).eq('id', jobId)
    }

    // --- Submit ---
    async function handleSubmit() {
      if (submitting) return

      setSubmitting(true)
      setSubmitError(null)
      setSaveError(null)

      try {
        // Validate required fields — every entry of a repeatable section.
        const missing: string[] = []
        for (const section of sections) {
          if (!checkConditionalLogic(section.conditional_logic, values)) continue
          const count = section.is_repeatable ? (instanceCounts[section.id] ?? 1) : 1
          for (let inst = 0; inst < count; inst++) {
            for (const field of section.fields) {
              if (!field.is_required) continue
              if (!checkConditionalLogic(field.conditional_logic, values)) continue
              const key = instanceKey(field.id, inst)
              const label = count > 1 ? `${field.label} (entry ${inst + 1})` : field.label
              if (field.field_type === 'signature' && !signatures[key]) {
                missing.push(label)
              } else if ((field.field_type === 'multiple_choice' || field.field_type === 'video_link') && !(arrayValues[key]?.length)) {
                missing.push(label)
              } else if (field.field_type === 'photo' && !(fieldPhotos[key]?.length)) {
                missing.push(label)
              } else if (!['signature', 'multiple_choice', 'video_link', 'photo', 'heading', 'divider', 'calculated'].includes(field.field_type)) {
                // yes_no / pass_fail store "answer|||remarks" — validate the ANSWER half,
                // so a field with only remarks (no Yes/No/Pass/Fail picked) still counts as missing.
                const raw = values[key] ?? ''
                const answerPart = raw.includes('|||') ? raw.split('|||')[0] : raw
                if (!answerPart.trim()) missing.push(label)
              }
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

        // Only re-save when there are genuinely unsaved edits. Re-uploading an
        // already-saved checklist adds several network round-trips that fail on
        // poor connections — the common "filled it, autosaved, now submit" case
        // should be a single small request, which is far more likely to complete
        // on flaky field wifi. (If autosave is off/unavailable, isDirty stays true
        // and we still save.)
        if (isDirty) {
          const saved = await handleSave()
          if (!saved) {
            const message = 'The latest edits could not be saved, so the checklist was not submitted. Please try Save Draft first, then submit again.'
            setSubmitError(message)
            return
          }
        }

        // Retry + verify so a dropped request on weak field wifi can't leave a
        // finished checklist unsubmitted (the real-world failure surveyors hit).
        const outcome = await submitJobWithRetry(jobId)

        if (outcome === 'denied') {
          console.error('[submit:jobUpdate] denied (0 rows, not submitted) for', jobId)
          const message = 'The checklist could not be submitted — your account may not have permission to update this job. Your answers are saved; please tell an admin so they can assign you or submit it.'
          setSaveError(message)
          setSubmitError(message)
          return
        }

        if (outcome === 'failed') {
          console.error('[submit:jobUpdate] could not reach server after retries for', jobId)
          const message = 'Submit could not reach the server after several tries. Your answers are saved — check your connection and tap Submit again.'
          setSaveError(message)
          setSubmitError(message)
          return
        }

        // The checklist IS submitted now. The remaining steps are best-effort
        // bookkeeping (advance the workflow to "report ready" + date the job by the
        // survey date). They must NEVER block the surveyor on a frozen grey dialog:
        // on a flaky connection the submit write can land while a follow-up request
        // stalls, so each is bounded by a timeout and failures are swallowed — the
        // surveyor is always taken back, and an admin can correct status if needed.
        await Promise.allSettled([
          withTimeout(advanceWorkflowTo(jobId, 'report_ready'), 8_000, 'Updating status'),
          withTimeout(syncJobDateFromChecklist(), 8_000, 'Dating the job'),
        ])
        setShowSubmitDialog(false)
        if (currentUserId) await withTimeout(deleteDraft(currentUserId, jobId), 5_000, 'Clearing draft').catch(() => {})
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
    async function uploadPhotoForField(fieldId: string, instance: number, file: File) {
      const key = instanceKey(fieldId, instance)
      setUploadingField(key)
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setUploadingField(null); return }

      const path = `${jobId}/${fieldId}/${instance}/${Date.now()}_${file.name}`
      let upErr: any = null
      try { ({ error: upErr } = await withTimeout(supabase.storage.from('job-photos').upload(path, file), 60_000, 'Uploading photo')) }
      catch { setSaveError('Photo upload timed out — check your connection and try the photo again.'); setUploadingField(null); return }
      if (upErr) { setSaveError('Photo upload failed: ' + upErr.message); setUploadingField(null); return }

      const { error: dbErr } = await supabase.from('job_photos').insert({
        job_id: jobId, field_id: fieldId, instance, storage_path: path,
        filename: file.name, uploaded_by: user.id,
      })
      if (dbErr) { setSaveError('Photo record failed: ' + dbErr.message); setUploadingField(null); return }

      const { data: fresh } = await supabase.from('job_photos').select('*').eq('job_id', jobId).eq('field_id', fieldId).eq('instance', instance)
      const nextFp = { ...fieldPhotos, [key]: fresh ?? [] }
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
      let upErr: any = null
      try { ({ error: upErr } = await withTimeout(supabase.storage.from('job-photos').upload(path, file), 60_000, 'Uploading photo')) }
      catch { setSaveError('Photo upload timed out — check your connection and try the photo again.'); setUploadingField(null); return }
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

    async function deletePhoto(photoId: string, storagePath: string, fieldKey?: string | null) {
      const supabase = createClient()
      const { error: storErr } = await supabase.storage.from('job-photos').remove([storagePath])
      if (storErr) { setSaveError('Delete failed: ' + storErr.message); return }
      const { error: dbErr } = await supabase.from('job_photos').delete().eq('id', photoId)
      if (dbErr) { setSaveError('Delete record failed: ' + dbErr.message); return }

      if (fieldKey) {
        const nextFp = { ...fieldPhotos, [fieldKey]: (fieldPhotos[fieldKey] ?? []).filter(p => p.id !== photoId) }
        setFieldPhotos(nextFp)
        void cacheServerPhotos(nextFp, generalPhotos)
      } else {
        const nextGp = generalPhotos.filter(p => p.id !== photoId)
        setGeneralPhotos(nextGp)
        void cacheServerPhotos(fieldPhotos, nextGp)
      }
    }

    // Re-attach an "Additional" (general) photo to a specific repeatable-section line +
    // entry, so it prints under that cargo line in the report. Fixes photos that were
    // added to the Additional Photos card by mistake.
    async function moveGeneralPhotoToLine(photo: any, fieldId: string, inst: number) {
      const supabase = createClient()
      const { error } = await supabase.from('job_photos').update({ field_id: fieldId, instance: inst }).eq('id', photo.id)
      if (error) { setSaveError('Could not move photo: ' + error.message); return }
      const key = instanceKey(fieldId, inst)
      const nextGp = generalPhotos.filter(p => p.id !== photo.id)
      const nextFp = { ...fieldPhotos, [key]: [...(fieldPhotos[key] ?? []), { ...photo, field_id: fieldId, instance: inst }] }
      setGeneralPhotos(nextGp)
      setFieldPhotos(nextFp)
      void cacheServerPhotos(nextFp, nextGp)
      toast.success('Photo moved to the line')
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
    // INVARIANT (read before changing): this UI edit-rule must never be BROADER than
    // the DB "Surveyors can update jobs" policy (migration 056 = any active surveyor)
    // and the PDF route's download rule. If the UI lets someone edit a job the DB
    // then refuses to update, you get the silent "submits but nothing saves / won't
    // download" bug. Equal-or-stricter is safe (a surveyor only sees THEIR jobs as
    // editable); broader is not. The submit handler also detects 0-row RLS denials.
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
        const srcField = allFieldsFlat.find(f => f.id === fieldId)
        // Not yet answered: show the source field's name as a placeholder (e.g.
        // "… of [Method of Delivery]") so the label is readable until selected.
        // NEVER return the whole `label` here — that duplicates the text and leaks
        // the raw token. Unknown/orphaned token id → drop it.
        if (!val) return srcField?.label ? `[${srcField.label}]` : ''
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
            {!hideInlinePdf && (
              <button
                onClick={downloadPdf}
                disabled={sharing}
                className="btn-secondary text-xs py-1.5 px-3"
              >
                {sharing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}Download / Share PDF
              </button>
            )}
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
          // Only count fields that are actually VISIBLE right now — a field hidden by
          // conditional logic can never be filled, so including it makes the counter
          // stick at e.g. "4/5" and never read complete.
          const dataFields = section.fields.filter(f => !['heading', 'divider'].includes(f.field_type) && checkConditionalLogic(f.conditional_logic, values))
          const count = section.is_repeatable ? (instanceCounts[section.id] ?? 1) : 1
          // Completion counts every entry of a repeatable section.
          const isFilled = (f: TemplateField, inst: number) => {
            const k = instanceKey(f.id, inst)
            if (f.field_type === 'signature') return !!signatures[k]
            if (f.field_type === 'multiple_choice' || f.field_type === 'video_link') return (arrayValues[k] ?? []).length > 0
            if (f.field_type === 'photo') return (fieldPhotos[k] ?? []).length > 0
            return !!values[k]
          }
          let completedCount = 0
          let totalCount = 0
          for (let inst = 0; inst < count; inst++) for (const f of dataFields) { totalCount++; if (isFilled(f, inst)) completedCount++ }

          // One field's control (input / photo widget) at a given repeatable instance.
          // instance 0 uses the bare field id, so non-repeatable sections are unchanged.
          const renderFieldControl = (field: TemplateField, inst: number) => {
            if (!checkConditionalLogic(field.conditional_logic, values)) return null
            const key = instanceKey(field.id, inst)
            if (field.field_type === 'photo') {
              const photos = fieldPhotos[key] ?? []
              const uploading = uploadingField === key
              // For a repeatable section, name the line so the surveyor knows these
              // photos attach HERE (not to the separate "Additional Photos" card).
              const firstTextField = section.fields.find((x: TemplateField) => x.field_type === 'text')
              const entryLabel = section.is_repeatable
                ? ((firstTextField && values[instanceKey(firstTextField.id, inst)]) || `Entry ${inst + 1}`)
                : ''
              return (
                <div key={key} className="space-y-1.5">
                  <label className="label-base mb-0">
                    {field.item_number && <span className="text-brand-600 font-semibold mr-1.5">{field.item_number}</span>}
                    {field.label}
                    {field.is_required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  {field.help_text && <p className="text-xs text-gray-500">{field.help_text}</p>}
                  {!readOnly && (
                    <div
                      className="space-y-2"
                      onDragOver={e => e.preventDefault()}
                      onDrop={async e => {
                        e.preventDefault()
                        const fs = e.dataTransfer?.files
                        if (!fs || !fs.length) return
                        for (const f of Array.from(fs)) await uploadPhotoForField(field.id, inst, f)
                      }}
                    >
                      <input
                        ref={el => { fieldPhotoRefs.current[key] = el }}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={async e => {
                          const files = e.target.files
                          if (!files) return
                          for (const f of Array.from(files)) await uploadPhotoForField(field.id, inst, f)
                          if (fieldPhotoRefs.current[key]) fieldPhotoRefs.current[key]!.value = ''
                        }}
                      />
                      {photos.length === 0 ? (
                        <div
                          onClick={() => !uploading && fieldPhotoRefs.current[key]?.click()}
                          className="border-2 border-dashed border-gray-300 rounded-lg py-6 text-center cursor-pointer hover:border-brand-300 transition-colors"
                        >
                          {uploading ? <Loader2 className="h-6 w-6 mx-auto text-brand-400 animate-spin" /> : (
                            <>
                              <Camera className="h-6 w-6 mx-auto text-gray-300 mb-1" />
                              <p className="text-sm text-gray-500">Drag &amp; drop or click to add photos{entryLabel ? ` for ${entryLabel}` : ''}</p>
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
                                  onClick={() => deletePhoto(p.id, p.storage_path, key)}
                                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => fieldPhotoRefs.current[key]?.click()}
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
                key={key}
                field={field}
                resolvedLabel={resolveLabel(field.label)}
                value={values[key] ?? ''}
                valueArray={arrayValues[key]}
                signature={signatures[key]}
                allValues={values}
                onChange={field.field_type === 'calculated' ? v => updateCalculatedValue(key, v) : v => updateValue(key, v)}
                onArrayChange={v => updateArrayValue(key, v)}
                onSignatureChange={data => updateSignature(key, data)}
                onBlur={v => {
                  const prefix = vesselPrefixForLabel(field.label)
                  if (!prefix) return
                  const next = normalizeVesselName(v, prefix)
                  if (next !== v) updateValue(key, next)
                }}
                readOnly={readOnly}
              />
            )
          }

          return (
            <div key={section.id} className="card overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="w-full flex items-center gap-3 px-5 py-4 bg-gray-50 border-b border-gray-200 text-left hover:bg-gray-100 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-900">{section.title}{section.is_repeatable && <span className="ml-2 text-[11px] font-medium text-brand-600 align-middle">repeatable</span>}</h2>
                  {section.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-500">{completedCount}/{totalCount}</span>
                  {collapsed ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronUp className="h-4 w-4 text-gray-400" />}
                </div>
              </button>

              {!collapsed && (
                <div className="p-5 space-y-5">
                  {section.is_repeatable ? (
                    <div className="space-y-4">
                      {Array.from({ length: count }).map((_, inst) => (
                        <div key={inst} className="rounded-xl border border-gray-200 bg-gray-50/40 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-semibold text-gray-700">{section.title} — Entry {inst + 1}</span>
                            {!readOnly && count > 1 && inst === count - 1 && (
                              <button type="button" onClick={() => removeLastInstance(section)} className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1">
                                <X className="h-3.5 w-3.5" /> Remove
                              </button>
                            )}
                          </div>
                          <div className="space-y-5">
                            {section.fields.map(field => renderFieldControl(field, inst))}
                          </div>
                        </div>
                      ))}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => addInstance(section.id)}
                          className="w-full rounded-xl border-2 border-dashed border-gray-300 py-3 text-sm font-medium text-brand-600 hover:border-brand-300 hover:bg-brand-50/40 transition-colors inline-flex items-center justify-center gap-1.5"
                        >
                          <Plus className="h-4 w-4" /> Add {section.title}
                        </button>
                      )}
                    </div>
                  ) : (
                    section.fields.map(field => renderFieldControl(field, 0))
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* General (extra) photos section */}
        {!readOnly && (
          <div
            className="card p-5"
            onDragOver={e => e.preventDefault()}
            onDrop={async e => {
              e.preventDefault()
              const fs = e.dataTransfer?.files
              if (!fs || !fs.length) return
              for (const f of Array.from(fs)) await uploadGeneralPhoto(f)
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="section-title">Additional Photos</h2>
                <p className="text-xs text-gray-500 mt-0.5">Photos NOT tied to an inspection line — rarely needed. Add line photos in each line&apos;s own Photos box above. (Already added one here? Use &ldquo;Move to a line&rdquo;.)</p>
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
              (() => {
                // Targets to re-attach a misfiled general photo to a cargo line + entry.
                const lineTargets: { fieldId: string; inst: number; label: string }[] = []
                for (const s of sections) {
                  if (!s.is_repeatable) continue
                  const photoFs = s.fields.filter(f => f.field_type === 'photo')
                  const firstText = s.fields.find(f => f.field_type === 'text')
                  const cnt = instanceCounts[s.id] ?? 1
                  for (const pf of photoFs) for (let i = 0; i < cnt; i++) {
                    const ln = firstText ? (values[instanceKey(firstText.id, i)] || '') : ''
                    lineTargets.push({ fieldId: pf.id, inst: i, label: `${ln || `Entry ${i + 1}`}${photoFs.length > 1 ? ` · ${pf.label}` : ''}` })
                  }
                }
                return (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {generalPhotos.map(p => (
                      <div key={p.id} className="rounded-lg border border-gray-200 overflow-hidden group">
                        <div className="relative aspect-square bg-gray-100 flex items-center justify-center">
                          <span className="text-xs text-gray-500 p-1 text-center break-all">{p.filename}</span>
                          <button
                            onClick={() => deletePhoto(p.id, p.storage_path, null)}
                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        {lineTargets.length > 0 && (
                          <select
                            value=""
                            onChange={e => { if (e.target.value) { const [fid, ii] = e.target.value.split('|'); void moveGeneralPhotoToLine(p, fid, Number(ii)) } }}
                            className="input-base text-xs py-1 w-full rounded-none border-0 border-t border-gray-100"
                            title="Attach this photo to a cargo line so it prints under that line"
                          >
                            <option value="">Move to a line…</option>
                            {lineTargets.map(t => <option key={`${t.fieldId}|${t.inst}`} value={`${t.fieldId}|${t.inst}`}>{t.label}</option>)}
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()
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

        {/* Bottom download only for a read-only checklist that is NOT yet submitted
            (the submitted banner above already carries the button). Hidden when the
            page provides its own header download. */}
        {readOnly && !isSubmitted && !hideInlinePdf && (
          <div className="flex justify-end">
            <button onClick={downloadPdf} disabled={sharing} className="btn-primary">
              {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download / Share PDF
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
