'use client'

import {
  useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback, useMemo, Fragment, type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2, Save, Send, Download, Camera, X, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, AlertTriangle, Eye,
  Cloud, CloudOff, RefreshCw, Plus, GripVertical, Trash2, Usb,
} from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { presentInstances, resolveEntryOrder, nextInstanceId, moveEntry } from '@/lib/checklist/entryOrder'
import { clearHiddenAnswers, type VisibilityUnit } from '@/lib/checklist/clearHidden'

// The .btn-* classes are 36px tall, under the ~44px touch target this app uses
// elsewhere (see JobOpsPanel's log rows). Applied to the controls a surveyor taps
// in the field — Save/Submit and the correct-a-mistake overrides.
const TAP_BTN = 'py-2.5 text-base sm:py-2 sm:text-sm'

/** A required field left blank at submit, with enough to link the surveyor straight to it. */
interface MissingField {
  /** instanceKey(field.id, instance) — also the DOM anchor. */
  key: string
  label: string
  itemNumber: string | null
}

/** DOM id of a field's scroll anchor. */
const fieldAnchorId = (key: string) => `field-${key}`

/**
 * Scroll a required-but-blank field into view and focus its first control.
 * A long checklist can hide a missed question hundreds of pixels off-screen, and naming it in
 * an error message still leaves the surveyor hunting for it.
 */
function jumpToField(key: string) {
  const el = typeof document !== 'undefined' ? document.getElementById(fieldAnchorId(key)) : null
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  // Focus after the scroll settles, so the browser doesn't fight it with its own jump.
  window.setTimeout(() => {
    const control = el.querySelector<HTMLElement>('input, select, textarea, button')
    control?.focus({ preventScroll: true })
  }, 350)
  el.classList.add('ring-2', 'ring-red-400', 'rounded-lg')
  window.setTimeout(() => el.classList.remove('ring-2', 'ring-red-400', 'rounded-lg'), 2200)
}
import { pickImageFiles } from '@/lib/files/pickImageFiles'
import { checkConditionalLogic, withTimeout, vesselPrefixForLabel, normalizeVesselName, isSurveyedVesselNameField, evaluateCalculation } from '@/lib/utils'
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

// One drag-sortable repeatable entry. The drag listeners go ONLY on the handle
// (not the whole card) so the entry's inputs stay scrollable/usable on touch.
function SortableEntry({ id, disabled, children }: {
  id: string
  disabled?: boolean
  children: (h: { handleRef: (el: HTMLElement | null) => void; handleProps: Record<string, any>; isDragging: boolean }) => ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition,
    opacity: isDragging ? 0.55 : 1, zIndex: isDragging ? 10 : undefined, position: 'relative',
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({ handleRef: setActivatorNodeRef, handleProps: { ...attributes, ...listeners }, isDragging })}
    </div>
  )
}

// Slim "insert a new entry in this gap" affordance shown between entries.
function InsertEntryButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="flex justify-center">
      <button type="button" onClick={onClick} title={label}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-600 bg-white border border-brand-200 hover:border-brand-400 hover:bg-brand-50 rounded-full px-2.5 py-1 shadow-sm transition-colors">
        <Plus className="h-3 w-3" /> Insert here
      </button>
    </div>
  )
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
    // Display order of each repeatable section's entries (sectionId → STABLE instance
    // ids). Only this list changes on insert/reorder — saved answers/photos never move.
    // See lib/checklist/entryOrder.ts + migration 106. orderFor() = the live order,
    // defaulting to a single empty entry.
    const [entryOrder, setEntryOrder] = useState<Record<string, number[]>>({})
    const orderFor = (sectionId: string): number[] => entryOrder[sectionId] ?? [0]
    // Drag-to-reorder sensors: a small drag threshold so taps still work, plus keyboard.
    const dndSensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )
    // fieldPhotos: photos keyed by instanceKey(field_id, instance); generalPhotos: extras with no field_id
    const [fieldPhotos, setFieldPhotos] = useState<Record<string, any[]>>({})
    const [generalPhotos, setGeneralPhotos] = useState<any[]>([])
    // photoUrls: storage_path → short-lived signed URL, so the editor can show real
    // thumbnails (the job-photos bucket is private). Display-only; never persisted.
    const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
    // Clicking a thumbnail opens it full-size in an on-screen lightbox (no download,
    // no navigation). null = closed.
    const [lightbox, setLightbox] = useState<{ url: string; filename?: string | null } | null>(null)
    // Close the lightbox with Escape, for desktop keyboard users.
    useEffect(() => {
      if (!lightbox) return
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [lightbox])
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
    // Repeatable entries collapsed to just their header bar (key = `${sectionId}:${inst}`),
    // so you can collapse all entries and expand only the one you want to review.
    const [collapsedEntries, setCollapsedEntries] = useState<Set<string>>(new Set())
    const [showSubmitDialog, setShowSubmitDialog] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [missingRequired, setMissingRequired] = useState<MissingField[]>([])
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
    // "This job exists only in IndexedDB, the server row isn't there yet." A ref
    // rather than state so the memoised handleSave can never read a stale copy.
    const pendingCreateRef = useRef(false)

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
      void signPhotos([...Object.values(draft.fieldPhotos ?? {}).flat(), ...(draft.generalPhotos ?? [])])
      // Rebuild each repeatable section's entry order from the draft's instance keys +
      // the saved order on the cached job, so a draft edited offline reopens with all
      // its entries in the order they were left.
      const maps = [draft.values, draft.arrayValues, draft.signatures, draft.fieldPhotos ?? {}] as Record<string, any>[]
      const savedOrder = (draft.job?.repeatable_order ?? {}) as Record<string, number[]>
      const order: Record<string, number[]> = {}
      for (const s of (draft.sections ?? []) as any[]) {
        if (!s.is_repeatable) continue
        const present = presentInstances((s.fields ?? []).map((f: any) => f.id), maps)
        order[s.id] = resolveEntryOrder(present, savedOrder[s.id])
      }
      setEntryOrder(order)
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
        // Fold the live repeatable-entry order into the cached job so an offline
        // reopen (and the next sync) restore the entries in the order left.
        key: '', jobId, userId: currentUserId, job: job ? { ...job, repeatable_order: entryOrder } : job,
        sections, values, arrayValues, signatures,
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
      // Preserve "started offline, not yet on the server" (same as persistDraft
      // above). Dropping it would take the draft out of BOTH getPendingDrafts and
      // getLocalCreateDrafts, so nothing would ever create the job row and the
      // whole job — answers included — would silently disappear.
      const existing = await getDraft(currentUserId, jobId).catch(() => undefined)
      const stillPendingCreate = existing?.pendingCreate || false
      await putDraft({
        key: '', jobId, userId: currentUserId, job, sections, values: v, arrayValues: a, signatures: s,
        fieldPhotos, generalPhotos,
        serverValues: v, serverArrayValues: a, serverSignatures: s,
        pendingSubmit: false, pendingCreate: stillPendingCreate, dirty: false,
        needsSync: stillPendingCreate, updatedAt: Date.now(),
        lastSyncedAt: Date.now(), syncError: null,
      }).catch(() => {})
      setSyncStatus(stillPendingCreate ? 'pending' : 'idle')
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
        pendingCreateRef.current = !!after?.pendingCreate
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
        // getUser() hits the network. On Android navigator.onLine frequently lies
        // (reports online during tower handovers / the first seconds after the PWA
        // wakes), so we take this online branch and getUser() fails even though the
        // session is fine — which used to throw a surveyor to /login mid-job. Fall
        // back to the locally-persisted session (the same credential the offline
        // branch trusts) before assuming the user is signed out.
        if (!userId) {
          const { data: { session } } = await supabase.auth.getSession()
          userId = session?.user?.id ?? null
        }
      }
      if (!userId) { router.push('/login'); return }
      setCurrentUserId(userId)
      pendingCreateRef.current = false

      // A job started offline lives only in the local draft until it syncs — the
      // server row may not exist yet, so load it from the draft regardless of
      // connectivity. Once synced, pendingCreate is cleared and normal load runs.
      const localCreate = await getDraft(userId, jobId).catch(() => undefined)
      if (localCreate && localCreate.userId === userId && localCreate.pendingCreate) {
        hydrateFromDraft(localCreate)
        pendingCreateRef.current = true
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
      // Repeatable-section entry order is resolved later from which instances carry
      // data (presentInstances) + the saved order; the bare field id is instance 0.
      for (const v of (valData ?? [])) {
        const inst = (v as any).instance ?? 0
        const key = instanceKey(v.field_id, inst)
        if (v.value_array) arrVals[key] = v.value_array
        else vals[key] = v.value ?? ''
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
          // A client_select field defaults to the job's client, and the survey Date
          // field to the job's scheduled date — both stay editable. This stops the
          // surveyor re-entering what the job already knows (the everyday double entry).
          if (field.field_type === 'client_select' && !vals[field.id] && jobData.client?.name) {
            vals[field.id] = jobData.client.name
          }
          if (field.field_type === 'date' && !vals[field.id] && jobData.scheduled_date
              && /date of survey|survey date|^date$|date of inspection|conducted on/i.test(field.label)) {
            vals[field.id] = jobData.scheduled_date
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
      }

      // Split photos by field (keyed per instance); field-less ones are "general".
      const fPhotos: Record<string, any[]> = {}
      const gPhotos: any[] = []
      for (const p of (photoData ?? [])) {
        if (p.field_id) {
          const inst = (p as any).instance ?? 0
          const key = instanceKey(p.field_id, inst)
          fPhotos[key] = [...(fPhotos[key] ?? []), p]
        } else gPhotos.push(p)
      }

      // Resolve each repeatable section's entry order from its present instance ids +
      // the saved order (jobs.repeatable_order). Absent order ⇒ natural ascending, i.e.
      // exactly as before, so legacy jobs are unchanged.
      const order: Record<string, number[]> = {}
      const savedOrder = (jobData.repeatable_order ?? {}) as Record<string, number[]>
      for (const section of processedSections) {
        if (!section.is_repeatable) continue
        const present = presentInstances(section.fields.map((f: any) => f.id), [vals, arrVals, sigs, fPhotos])
        order[section.id] = resolveEntryOrder(present, savedOrder[section.id])
      }

      setJob(jobData)
      setSections(processedSections)
      setValues(vals)
      setArrayValues(arrVals)
      setSignatures(sigs)
      setEntryOrder(order)
      setFieldPhotos(fPhotos)
      setGeneralPhotos(gPhotos)
      void signPhotos([...Object.values(fPhotos).flat(), ...gPhotos])

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

    // Every answer slot on the checklist, paired with the rules that decide whether it is shown.
    // Rebuilt only when the template or the repeatable entry order changes.
    const visibilityUnits = useMemo<VisibilityUnit[]>(() => {
      const units: VisibilityUnit[] = []
      for (const section of sections) {
        const instances = section.is_repeatable ? (entryOrder[section.id] ?? [0]) : [0]
        for (const inst of instances) {
          for (const field of section.fields) {
            if (field.field_type === 'heading' || field.field_type === 'divider') continue
            units.push({
              key: instanceKey(field.id, inst),
              logic: field.conditional_logic ?? null,
              sectionLogic: section.conditional_logic ?? null,
            })
          }
        }
      }
      return units
    }, [sections, entryOrder])

    // --- Value setters that mark dirty ---
    // Changing an answer can hide other fields. Their stored answers are cleared here, because a
    // hidden answer is invisible to the surveyor yet still feeds every conditional that references
    // it and still prints in the report — see lib/checklist/clearHidden.
    //
    // Deliberately done HERE, on a user edit, and not in an effect: during load every value starts
    // empty, so every dependent field would look hidden and a completed checklist would be wiped.
    const updateValue = useCallback((fieldId: string, val: string) => {
      setValues(prev => {
        const next = { ...prev, [fieldId]: val }
        // Never sweep on an EMPTY new value. A number input passes through '' on every
        // keystroke, and a numeric condition treats '' as failing (parseFloat('') is NaN) — so
        // backspacing Ultrasonic's "Number of holds" to retype it would momentarily hide, and
        // therefore blank, every gated Hold/Bilge answer in every test round. The residue this
        // leaves (deliberately blanking a controlling field keeps its dependants' answers) is
        // exactly the old behaviour, so nothing regresses.
        if (!val) return next
        return clearHiddenAnswers(visibilityUnits, next) ?? next
      })
      setIsDirty(true)
    }, [visibilityUnits])

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

    // --- Repeatable-section entries (stable ids + a separate display order) ---
    // Persist a section's new order to jobs.repeatable_order (online); always update
    // local state + mark dirty so the offline draft and next save carry it too.
    async function persistOrder(sectionId: string, next: number[]) {
      const merged = { ...entryOrder, [sectionId]: next }
      setEntryOrder(merged)
      setIsDirty(true)
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      const supabase = createClient()
      try { await supabase.from('jobs').update({ repeatable_order: merged }).eq('id', jobId) } catch { /* best effort — draft + next save still carry it */ }
    }

    // Add a new empty entry at the end.
    function addInstance(sectionId: string) {
      const order = orderFor(sectionId)
      void persistOrder(sectionId, [...order, nextInstanceId(order)])
    }

    // Insert a new empty entry at display position `pos` (e.g. between 4 and 5). The
    // new entry gets a fresh, never-reused instance id — nothing else moves.
    function insertEntryAt(sectionId: string, pos: number) {
      const order = orderFor(sectionId)
      const next = order.slice()
      next.splice(Math.max(0, Math.min(pos, next.length)), 0, nextInstanceId(order))
      void persistOrder(sectionId, next)
    }

    // Reorder: move the entry at display position `from` to `to` (drag-and-drop).
    function moveEntryTo(sectionId: string, from: number, to: number) {
      if (from === to) return
      void persistOrder(sectionId, moveEntry(orderFor(sectionId), from, to))
    }

    // dnd-kit drag end → translate the dragged/over instance ids into a move.
    function handleEntryDragEnd(sectionId: string, event: DragEndEvent) {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const order = orderFor(sectionId)
      const from = order.findIndex(id => String(id) === active.id)
      const to = order.findIndex(id => String(id) === over.id)
      if (from !== -1 && to !== -1) moveEntryTo(sectionId, from, to)
    }

    // Remove the entry at display position `pos`: delete its saved rows/photos (keyed
    // by its STABLE instance id) and drop it from the order. Any entry is removable.
    async function removeEntryAt(section: SectionWithFields, pos: number) {
      const order = orderFor(section.id)
      if (order.length <= 1) return
      const inst = order[pos]
      if (inst == null) return
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
      setCollapsedEntries(prev => { const n = new Set(prev); n.delete(`${section.id}:${inst}`); return n })
      void persistOrder(section.id, order.filter((_, i) => i !== pos))
    }

    // --- Save (returns true on success) ---
    const handleSave = useCallback(async (): Promise<boolean> => {
      setSaving(true)
      setSaveError(null)

      // Offline: persist locally instead of calling Supabase. A job started offline
      // takes the same path even when we're online — its server row doesn't exist
      // yet, so the job_field_values FK would reject every answer. Save locally and
      // let the sync create the job first.
      if (pendingCreateRef.current || (offlineAvailable() && typeof navigator !== 'undefined' && !navigator.onLine)) {
        try {
          await persistDraft(false)
          setLastSaved(new Date())
          setIsDirty(false)
          setSyncStatus('pending')
          // Publish straight away when there IS a connection (no-op offline).
          void syncNow()
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
          const instIds = section.is_repeatable ? (entryOrder[section.id] ?? [0]) : [0]
          for (const field of section.fields) {
            if (field.field_type !== 'calculated' || !field.calculation_formula) continue
            // Skip calcs the template is currently hiding, or this would resurrect a result that
            // clearHiddenAnswers just blanked (its inputs can still be populated) and feed it back
            // into the conditionals on the next load.
            if (!checkConditionalLogic(section.conditional_logic, valuesToSave)) continue
            if (!checkConditionalLogic(field.conditional_logic, valuesToSave)) continue
            // Recompute the calc for EACH entry against that entry's own inputs.
            for (const inst of instIds) {
              const k = instanceKey(field.id, inst)
              const result = evaluateCalculation(field.calculation_formula, valuesToSave, inst)
              if (result !== (valuesToSave[k] ?? '')) computed[k] = result
            }
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
        // Persist the repeatable-entry order alongside answers (safety net for any
        // immediate persistOrder() write that didn't land). Best-effort — never block
        // a save on it. No-op when there are no repeatable sections.
        if (Object.keys(entryOrder).length) {
          try { await supabase.from('jobs').update({ repeatable_order: entryOrder }).eq('id', jobId) } catch { /* order re-saves on the next save */ }
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
    }, [jobId, values, arrayValues, signatures, sections, entryOrder]) // eslint-disable-line react-hooks/exhaustive-deps

    // Date the job by the SURVEY date the surveyor entered (the first answered
    // date field), not the day the job was created. Updates scheduled_date — the
    // job's START day, which feeds the calendar, report numbering and the fine-print
    // line under the jobs-list Date column — and swaps the trailing DD-MM-YYYY in
    // the auto-generated title. No-op if no date field is filled.
    async function syncJobDateFromChecklist() {
      let surveyDate: string | null = null
      outer: for (const s of sections) {
        for (const f of s.fields) {
          if (f.field_type === 'date' && values[f.id]) { surveyDate = values[f.id]; break outer }
        }
      }
      if (!surveyDate || !/^\d{4}-\d{2}-\d{2}$/.test(surveyDate)) return
      const [yy, mm, dd] = surveyDate.split('-')
      const patch: Record<string, any> = {}
      // A checklist date later than the job's end date would invert the range (the
      // lists would then show a job "ending" before it started), so on a multi-day
      // job the start date only moves when it stays on or before end_date. The
      // title still follows the surveyor's date either way.
      if (!job?.end_date || surveyDate <= job.end_date) patch.scheduled_date = surveyDate
      if (job?.title) {
        const retitled = job.title.replace(/\d{2}-\d{2}-\d{4}\s*$/, `${dd}-${mm}-${yy}`)
        if (retitled !== job.title) patch.title = retitled
      }
      if (Object.keys(patch).length === 0) return
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
        // Each carries its anchor key so the error message can link straight to the field.
        const missing: MissingField[] = []
        for (const section of sections) {
          if (!checkConditionalLogic(section.conditional_logic, values)) continue
          const ids = section.is_repeatable ? orderFor(section.id) : [0]
          ids.forEach((inst, pos) => {
            for (const field of section.fields) {
              if (!field.is_required) continue
              if (!checkConditionalLogic(field.conditional_logic, values)) continue
              const key = instanceKey(field.id, inst)
              const label = ids.length > 1 ? `${field.label} (entry ${pos + 1})` : field.label
              const miss = { key, label, itemNumber: field.item_number ?? null }
              if (field.field_type === 'signature' && !signatures[key]) {
                missing.push(miss)
              } else if ((field.field_type === 'multiple_choice' || field.field_type === 'video_link') && !(arrayValues[key]?.length)) {
                missing.push(miss)
              } else if (field.field_type === 'photo' && !(fieldPhotos[key]?.length)) {
                missing.push(miss)
              } else if (!['signature', 'multiple_choice', 'video_link', 'photo', 'heading', 'divider', 'calculated'].includes(field.field_type)) {
                // yes_no / pass_fail store "answer|||remarks" — validate the ANSWER half,
                // so a field with only remarks (no Yes/No/Pass/Fail picked) still counts as missing.
                const raw = values[key] ?? ''
                const answerPart = raw.includes('|||') ? raw.split('|||')[0] : raw
                if (!answerPart.trim()) missing.push(miss)
              }
            }
          })
        }

        if (missing.length > 0) {
          setMissingRequired(missing)
          const message = `Required fields not completed: ${missing.map(m => m.label).join(', ')}`
          setSaveError(message)
          setSubmitError(message)
          return
        }
        setMissingRequired([])

        // Offline: queue the submit locally; it is applied to the server on sync.
        // A job started offline queues the same way even when we're online — the
        // job row doesn't exist yet, so submitting it directly would just be denied.
        // syncDraft creates the job, pushes the answers and then submits, in order.
        if (pendingCreateRef.current || (offlineAvailable() && typeof navigator !== 'undefined' && !navigator.onLine)) {
          await persistDraft(true)
          setIsDirty(false)
          setSyncStatus('pending')
          setShowSubmitDialog(false)
          // Publish straight away when there IS a connection (no-op offline).
          void syncNow()
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
    // Generate short-lived signed URLs for a batch of photo rows so they can be shown
    // as real thumbnails. The bucket is private, so we can't use the path directly.
    // Merges into photoUrls (path → url); existing entries are kept. Best-effort: if
    // signing fails (e.g. offline) the UI just falls back to the filename text.
    async function signPhotos(rows: any[]) {
      const paths = Array.from(new Set(rows.map(r => r?.storage_path).filter(Boolean))) as string[]
      if (paths.length === 0) return
      const supabase = createClient()
      const { data } = await supabase.storage.from('job-photos').createSignedUrls(paths, 3600)
      if (!data) return
      setPhotoUrls(prev => {
        const next = { ...prev }
        for (const s of data) if (s.path && s.signedUrl) next[s.path] = s.signedUrl
        return next
      })
    }

    // Import photos via the device's file picker so a plugged-in USB/OTG drive (where
    // the borescope saves photos) is reachable — see lib/files/pickImageFiles.
    function pickFromFiles(onFiles: (files: File[]) => void) {
      pickImageFiles((images, rejected) => {
        if (images.length) onFiles(images)
        if (rejected.length) setSaveError(`Skipped non-image file${rejected.length > 1 ? 's' : ''}: ${rejected.join(', ')}`)
      })
    }

    // Upload one or more photos to a field/instance in a single pass: authenticate
    // ONCE, upload each file (a per-file failure is reported but doesn't drop the
    // others), then ONE batch insert + ONE re-select/sign/cache — instead of the old
    // per-file N+1 (re-auth + re-select every file) that was costly on flaky wifi.
    async function uploadPhotosForField(fieldId: string, instance: number, files: File[]) {
      if (!files.length) return
      const key = instanceKey(fieldId, instance)
      setUploadingField(key)
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setSaveError('Your session expired — sign in again to add photos.'); return }
        const rows: any[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const path = `${jobId}/${fieldId}/${instance}/${Date.now()}_${i}_${file.name}`
          let upErr: any = null
          try { ({ error: upErr } = await withTimeout(supabase.storage.from('job-photos').upload(path, file), 60_000, 'Uploading photo')) }
          catch { setSaveError('A photo upload timed out — check your connection and try again.'); continue }
          if (upErr) { setSaveError('Photo upload failed: ' + upErr.message); continue }
          rows.push({ job_id: jobId, field_id: fieldId, instance, storage_path: path, filename: file.name, uploaded_by: user.id })
        }
        if (rows.length) {
          const { error: dbErr } = await supabase.from('job_photos').insert(rows)
          if (dbErr) { setSaveError('Photo record failed: ' + dbErr.message); return }
        }
        const { data: fresh } = await supabase.from('job_photos').select('*').eq('job_id', jobId).eq('field_id', fieldId).eq('instance', instance)
        const nextFp = { ...fieldPhotos, [key]: fresh ?? [] }
        setFieldPhotos(nextFp)
        void signPhotos(fresh ?? [])
        void cacheServerPhotos(nextFp, generalPhotos)
      } finally {
        setUploadingField(null)
      }
    }

    async function uploadGeneralPhotos(files: File[]) {
      if (!files.length) return
      setUploadingField('general')
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { setSaveError('Your session expired — sign in again to add photos.'); return }
        const rows: any[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const path = `${jobId}/general/${Date.now()}_${i}_${file.name}`
          let upErr: any = null
          try { ({ error: upErr } = await withTimeout(supabase.storage.from('job-photos').upload(path, file), 60_000, 'Uploading photo')) }
          catch { setSaveError('A photo upload timed out — check your connection and try again.'); continue }
          if (upErr) { setSaveError('Photo upload failed: ' + upErr.message); continue }
          rows.push({ job_id: jobId, field_id: null, storage_path: path, filename: file.name, uploaded_by: user.id })
        }
        if (rows.length) {
          const { error: dbErr } = await supabase.from('job_photos').insert(rows)
          if (dbErr) { setSaveError('Photo record failed: ' + dbErr.message); return }
        }
        const { data: fresh } = await supabase.from('job_photos').select('*').eq('job_id', jobId).is('field_id', null)
        const nextGp = fresh ?? []
        setGeneralPhotos(nextGp)
        void signPhotos(nextGp)
        void cacheServerPhotos(fieldPhotos, nextGp)
      } finally {
        setUploadingField(null)
      }
    }

    async function deletePhoto(photoId: string, storagePath: string, fieldKey?: string | null) {
      if (!(await confirmDialog({ message: 'Delete this photo? This cannot be undone.', danger: true, confirmLabel: 'Delete' }))) return
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

    function toggleEntryCollapse(key: string) {
      setCollapsedEntries(prev => {
        const next = new Set(prev)
        next.has(key) ? next.delete(key) : next.add(key)
        return next
      })
    }

    // Collapse or expand every entry of a repeatable section in one go (keyed by the
    // entry's stable instance id, so the state follows the entry through reorders).
    function setAllEntriesCollapsed(section: SectionWithFields, collapsed: boolean) {
      setCollapsedEntries(prev => {
        const next = new Set(prev)
        for (const inst of orderFor(section.id)) {
          const key = `${section.id}:${inst}`
          if (collapsed) next.add(key); else next.delete(key)
        }
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
    // A closed job is frozen for surveyors too (it has been invoiced). It
    // behaves like a submitted job: read-only for everyone except a privileged re-open.
    const isClosed = job.workflow_status === 'closed'
    const isLocked = isSubmitted || isClosed

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
    const canOverride = isPrivileged && !canEditByIdentity && !isLocked
    const editingDenied = !canEditByIdentity && !adminOverride

    // A privileged user can re-open a submitted/completed/closed checklist to correct
    // mistakes via an explicit confirmed action. Saving preserves the job's current
    // status (it is NOT re-submitted), so e.g. a closed job stays closed.
    const adminEditingSubmitted = isPrivileged && isLocked && editSubmitted

    const readOnly = forceReadOnly || (
      isLocked ? !adminEditingSubmitted : editingDenied
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
        {/* Top action bar. Wraps so the buttons drop to their own full-width row on
            a phone instead of being pushed off the right edge — the title's nowrap
            min-content width alone is wider than a 360px viewport, and neither side
            could shrink before (min-w-0 on the left, no flex-shrink-0 on the right). */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="page-title truncate">{job.title}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <span className="text-sm text-gray-500">{job.job_number}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${WORKFLOW[job.workflow_status as WorkflowStatus]?.pill ?? ''}`}>
                {WORKFLOW[job.workflow_status as WorkflowStatus]?.label ?? job.workflow_status}
              </span>
              {lastSaved && !isDirty && (
                <span className="text-xs text-gray-400">Saved {lastSaved.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {/* Below sm: these buttons collapse to bare icons, and the two amber
              triangles can appear side by side — so each carries its label as a
              title/aria-label or they're indistinguishable on a phone. */}
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto sm:flex-shrink-0">
            {!readOnly && isDirty && (
              <span className="hidden sm:inline text-xs text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button onClick={() => setShowPreview(true)} className={`btn-secondary ${TAP_BTN}`} title="Preview" aria-label="Preview">
              <Eye className="h-4 w-4" /><span className="hidden sm:inline">Preview</span>
            </button>
            {readOnly && canOverride && (
              <button onClick={() => setShowOverrideDialog(true)} className={`btn-secondary text-amber-700 border-amber-300 hover:bg-amber-50 ${TAP_BTN}`} title="Edit as admin" aria-label="Edit as admin">
                <AlertTriangle className="h-4 w-4" /><span className="hidden sm:inline">Edit as admin</span>
              </button>
            )}
            {isLocked && isPrivileged && !editSubmitted && !forceReadOnly && (
              <button
                onClick={() => setShowEditSubmittedDialog(true)}
                className={`btn-secondary text-amber-700 border-amber-300 hover:bg-amber-50 ${TAP_BTN}`}
                title={isClosed && !isSubmitted ? 'Edit closed' : 'Edit submitted'}
                aria-label={isClosed && !isSubmitted ? 'Edit closed' : 'Edit submitted'}
              >
                <AlertTriangle className="h-4 w-4" /><span className="hidden sm:inline">{isClosed && !isSubmitted ? 'Edit closed' : 'Edit submitted'}</span>
              </button>
            )}
            {/* The single manual Save Draft lives in the sticky bottom bar (beside Submit);
                the header shows only autosave status ("Saved HH:MM" / "Unsaved changes"). */}
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

        {/* Closed jobs are locked for surveyors (payments settled against them). */}
        {readOnly && isClosed && !isPrivileged && (
          <div className="rounded-lg bg-gray-100 border border-gray-200 px-4 py-3 text-sm text-gray-700 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 mt-0.5 text-gray-500" />
            <span>This job has been invoiced and closed — the checklist is locked and can no longer be edited.</span>
          </div>
        )}

        {/* Read-only notice for users who are not the assigned surveyor/creator */}
        {readOnly && !isLocked && editingDenied && (
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
          // Entry instance ids in display order (repeatable), else the single instance 0.
          const entryIds = section.is_repeatable ? orderFor(section.id) : [0]
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
          for (const inst of entryIds) for (const f of dataFields) { totalCount++; if (isFilled(f, inst)) completedCount++ }

          // One field's control (input / photo widget) at a given repeatable instance.
          // instance 0 uses the bare field id, so non-repeatable sections are unchanged.
          // `inst` is the entry's STABLE instance id (for data); `pos` is its current
          // display position (0-based) — used only for the "Entry N" label so the
          // number tracks the visible order after inserts/reorders.
          // Wraps a field's control in an anchor the "required fields not completed" message can
          // scroll to. Returns null for hidden fields, so no empty anchors are emitted.
          const renderFieldAnchored = (field: TemplateField, inst: number, pos = 0) => {
            const control = renderFieldControl(field, inst, pos)
            if (control === null) return null
            const key = instanceKey(field.id, inst)
            return (
              <div key={key} id={fieldAnchorId(key)} className="scroll-mt-24">
                {control}
              </div>
            )
          }

          const renderFieldControl = (field: TemplateField, inst: number, pos = 0) => {
            if (!checkConditionalLogic(field.conditional_logic, values)) return null
            const key = instanceKey(field.id, inst)
            if (field.field_type === 'photo') {
              const photos = fieldPhotos[key] ?? []
              const uploading = uploadingField === key
              // For a repeatable section, name the line so the surveyor knows these
              // photos attach HERE (not to the separate "Additional Photos" card).
              const firstTextField = section.fields.find((x: TemplateField) => x.field_type === 'text')
              const entryLabel = section.is_repeatable
                ? ((firstTextField && values[instanceKey(firstTextField.id, inst)]) || `Entry ${pos + 1}`)
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
                        await uploadPhotosForField(field.id, inst, Array.from(fs))
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
                          await uploadPhotosForField(field.id, inst, Array.from(files))
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
                                {photoUrls[p.storage_path] ? (
                                  <img src={photoUrls[p.storage_path]} alt={p.filename ?? 'photo'} loading="lazy" onClick={() => setLightbox({ url: photoUrls[p.storage_path], filename: p.filename })} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" />
                                ) : (
                                  <span className="text-xs text-gray-500 p-1 text-center break-all">{p.filename}</span>
                                )}
                                <button
                                  onClick={() => deletePhoto(p.id, p.storage_path, key)}
                                  aria-label="Delete photo"
                                  className="absolute top-1 right-1 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                >
                                  <X className="h-4 w-4" />
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
                      {/* Reaches a plugged-in USB/OTG drive (where the borescope saves
                          photos) — the camera/gallery picker doesn't show it. */}
                      <button type="button" onClick={() => pickFromFiles(files => uploadPhotosForField(field.id, inst, files))} disabled={uploading} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700">
                        <Usb className="h-3.5 w-3.5" /> Import from Files / USB
                      </button>
                    </div>
                  )}
                  {readOnly && (
                    photos.length === 0 ? (
                      <p className="text-sm text-gray-400">No photos</p>
                    ) : (
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {photos.map(p => (
                          <div key={p.id} className="relative aspect-square rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden">
                            {photoUrls[p.storage_path] ? (
                              <img src={photoUrls[p.storage_path]} alt={p.filename ?? 'photo'} loading="lazy" onClick={() => setLightbox({ url: photoUrls[p.storage_path], filename: p.filename })} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" />
                            ) : (
                              <span className="text-xs text-gray-500 p-1 text-center break-all">{p.filename}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )
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
                instance={inst}
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
                    <div className="space-y-3">
                      {entryIds.length > 1 && (() => {
                        const anyOpen = entryIds.some(id => !collapsedEntries.has(`${section.id}:${id}`))
                        return (
                          <div className="flex justify-end">
                            <button type="button" onClick={() => setAllEntriesCollapsed(section, anyOpen)} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                              {anyOpen ? 'Collapse all' : 'Expand all'}
                            </button>
                          </div>
                        )
                      })()}
                      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={e => handleEntryDragEnd(section.id, e)}>
                        <SortableContext items={entryIds.map(String)} strategy={verticalListSortingStrategy}>
                          {entryIds.map((inst, pos) => {
                            const entryKey = `${section.id}:${inst}`
                            const entryCollapsed = collapsedEntries.has(entryKey)
                            const firstText = section.fields.find(f => f.field_type === 'text')
                            const entryName = (firstText && values[instanceKey(firstText.id, inst)]) || ''
                            const canEdit = !readOnly && entryIds.length > 1
                            return (
                              <Fragment key={inst}>
                                {/* Insert a new entry in the gap ABOVE this one — covers the
                                    top gap and every gap between entries (the end is the big
                                    "Add" button below). */}
                                {!readOnly && (
                                  <InsertEntryButton onClick={() => insertEntryAt(section.id, pos)} label={`Insert ${section.title} above`} />
                                )}
                                <SortableEntry id={String(inst)} disabled={!canEdit}>
                                  {({ handleRef, handleProps, isDragging }) => (
                                    <div className={`rounded-xl border bg-white shadow-sm overflow-hidden ${isDragging ? 'border-brand-300 ring-2 ring-brand-200' : 'border-gray-200'}`}>
                                      {/* Colour bar: drag handle (reorder) · tap title to collapse · remove. */}
                                      <div className="flex items-center justify-between gap-1.5 px-3 py-2.5 bg-brand-600 text-white">
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                          {canEdit && (
                                            <button ref={handleRef} {...handleProps} type="button" title="Drag to reorder" aria-label="Drag to reorder" className="flex-shrink-0 cursor-grab touch-none text-white/75 hover:text-white p-0.5">
                                              <GripVertical className="h-4 w-4" />
                                            </button>
                                          )}
                                          <button type="button" onClick={() => toggleEntryCollapse(entryKey)} className="flex items-center gap-2 min-w-0 flex-1 text-left" title={entryCollapsed ? 'Expand entry' : 'Collapse entry'}>
                                            {entryCollapsed ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronUp className="h-4 w-4 flex-shrink-0" />}
                                            <span className="text-sm font-semibold min-w-0 truncate leading-snug">
                                              {section.title} — Entry {pos + 1}
                                              {entryName ? <span className="font-normal text-white/85"> · {entryName}</span> : ''}
                                            </span>
                                          </button>
                                        </div>
                                        {canEdit && (
                                          <button type="button" onClick={() => removeEntryAt(section, pos)} title="Remove this entry" className="text-xs font-medium text-white/85 hover:text-white inline-flex items-center gap-1 flex-shrink-0">
                                            <Trash2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Remove</span>
                                          </button>
                                        )}
                                      </div>
                                      {!entryCollapsed && (
                                        <div className="p-4 space-y-5">
                                          {section.fields.map(field => renderFieldAnchored(field, inst, pos))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </SortableEntry>
                              </Fragment>
                            )
                          })}
                        </SortableContext>
                      </DndContext>
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
                    section.fields.map(field => renderFieldAnchored(field, 0))
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
              await uploadGeneralPhotos(Array.from(fs))
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
                  await uploadGeneralPhotos(Array.from(files))
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
                  const ids = orderFor(s.id)
                  for (const pf of photoFs) ids.forEach((inst, pos) => {
                    const ln = firstText ? (values[instanceKey(firstText.id, inst)] || '') : ''
                    lineTargets.push({ fieldId: pf.id, inst, label: `${ln || `Entry ${pos + 1}`}${photoFs.length > 1 ? ` · ${pf.label}` : ''}` })
                  })
                }
                return (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                    {generalPhotos.map(p => (
                      <div key={p.id} className="rounded-lg border border-gray-200 overflow-hidden group">
                        <div className="relative aspect-square bg-gray-100 flex items-center justify-center">
                          {photoUrls[p.storage_path] ? (
                            <img src={photoUrls[p.storage_path]} alt={p.filename ?? 'photo'} loading="lazy" onClick={() => setLightbox({ url: photoUrls[p.storage_path], filename: p.filename })} className="absolute inset-0 w-full h-full object-cover cursor-zoom-in" />
                          ) : (
                            <span className="text-xs text-gray-500 p-1 text-center break-all">{p.filename}</span>
                          )}
                          <button
                            onClick={() => deletePhoto(p.id, p.storage_path, null)}
                            aria-label="Delete photo"
                            className="absolute top-1 right-1 w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                          >
                            <X className="h-4 w-4" />
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
            {/* Reaches a plugged-in USB/OTG drive for additional photos too. */}
            <button type="button" onClick={() => pickFromFiles(files => uploadGeneralPhotos(files))} className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700">
              <Usb className="h-3.5 w-3.5" /> Import from Files / USB
            </button>
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
                <button onClick={handleSave} disabled={saving} className={`btn-secondary ${TAP_BTN}`}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save Draft'}
                </button>
                {!isSubmitted && (
                  <button
                    onClick={() => { setSubmitError(null); setShowSubmitDialog(true) }}
                    disabled={saving || submitting}
                    className={`btn-primary ${TAP_BTN}`}
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

        {/* Full-size photo lightbox — opens on-screen over everything (portaled to
            body so no transformed ancestor can clip it), closes on click / ✕ / Esc. */}
        {lightbox && typeof document !== 'undefined' && createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/85 flex items-center justify-center p-4"
            onClick={() => setLightbox(null)}
          >
            <button aria-label="Close" onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white/90 hover:text-white">
              <X className="h-7 w-7" />
            </button>
            <div className="max-w-6xl max-h-[92vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
              <img src={lightbox.url} alt={lightbox.filename ?? 'photo'} className="max-w-full max-h-[85vh] object-contain rounded shadow-2xl" />
              {lightbox.filename && <p className="text-white/80 text-center text-sm mt-3 break-all">{lightbox.filename}</p>}
            </div>
          </div>,
          document.body
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
          error={missingRequired.length > 0 ? (
            <div className="space-y-2">
              <p className="font-medium">
                {missingRequired.length} required {missingRequired.length === 1 ? 'question' : 'questions'} not answered.
                Tap one to go straight to it:
              </p>
              <ul className="space-y-1">
                {missingRequired.map(m => (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => { setShowSubmitDialog(false); jumpToField(m.key) }}
                      className="text-left underline underline-offset-2 hover:text-red-900"
                    >
                      {m.itemNumber && <span className="font-semibold mr-1">{m.itemNumber}</span>}
                      {m.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : submitError}
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
                    // Iterate every entry of a repeatable section (instance ids in display
                    // order) — not just instance 0 — so the Preview matches the report.
                    const entryIds = section.is_repeatable ? orderFor(section.id) : [0]
                    const renderPreviewField = (field: TemplateField, inst: number) => {
                      if (!checkConditionalLogic(field.conditional_logic, values)) return null
                      const key = instanceKey(field.id, inst)
                      if (field.field_type === 'photo') {
                        const count = (fieldPhotos[key] ?? []).length
                        return (
                          <div key={key} className="space-y-1">
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
                          key={key}
                          field={field}
                          resolvedLabel={resolveLabel(field.label)}
                          value={values[key] ?? ''}
                          valueArray={arrayValues[key]}
                          signature={signatures[key]}
                          allValues={values}
                          instance={inst}
                          onChange={() => {}}
                          readOnly
                        />
                      )
                    }
                    return (
                      <div key={section.id} className="card overflow-hidden">
                        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                          <h3 className="font-semibold text-gray-900">{section.title}</h3>
                          {section.description && <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>}
                        </div>
                        <div className="p-5 space-y-4">
                          {entryIds.map((inst, pos) => {
                            const block = section.fields.map(field => renderPreviewField(field, inst))
                            if (!section.is_repeatable) return <div key={inst} className="space-y-4">{block}</div>
                            return (
                              <div key={inst} className="rounded-lg border border-gray-200 overflow-hidden">
                                <div className="px-3 py-1.5 bg-brand-50 text-xs font-semibold text-brand-700">{section.title} — Entry {pos + 1}</div>
                                <div className="p-3 space-y-4">{block}</div>
                              </div>
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
