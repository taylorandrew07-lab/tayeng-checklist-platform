'use client'

import {
  useState, useEffect, useRef, forwardRef, useImperativeHandle, useCallback,
} from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Loader2, Save, Send, Download, Camera, X, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, AlertTriangle,
} from 'lucide-react'
import { formatDate, checkConditionalLogic, getJobStatusLabel, getJobStatusColor } from '@/lib/utils'
import FieldRenderer from '@/components/job/FieldRenderer'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import type { TemplateField, TemplateSection, JobFieldValue, JobSignature } from '@/lib/types/database'

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
}

const JobChecklistEditor = forwardRef<JobChecklistEditorHandle, Props>(
  function JobChecklistEditor({ jobId, backHref }, ref) {
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
    const [showLeaveDialog, setShowLeaveDialog] = useState(false)
    const [leaveDestination, setLeaveDestination] = useState<string | null>(null)
    const [uploadingField, setUploadingField] = useState<string | null>(null)
    const generalPhotoRef = useRef<HTMLInputElement>(null)
    const fieldPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({})

    // Expose isDirty + save + navigate to parent via ref
    useImperativeHandle(ref, () => ({
      get isDirty() { return isDirty },
      save: handleSave,
      navigate: requestNavigate,
    }))

    // Warn on browser close/refresh when dirty
    useEffect(() => {
      const handler = (e: BeforeUnloadEvent) => {
        if (isDirty) { e.preventDefault(); e.returnValue = '' }
      }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }, [isDirty])

    useEffect(() => { load() }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

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
          if (field.default_value && !vals[field.id] && !arrVals[field.id]) {
            vals[field.id] = field.default_value
          }
          // Auto-fill vessel/surveyor from job metadata (only if field is text and currently empty)
          if (field.field_type === 'text' && !vals[field.id]) {
            const lbl = field.label.toLowerCase()
            if (lbl.includes('vessel') && jobData.vessel_name) {
              vals[field.id] = jobData.vessel_name
            } else if (lbl.includes('surveyor') && jobData.surveyor_name) {
              vals[field.id] = jobData.surveyor_name
            }
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

      if (jobData.status === 'assigned') {
        await supabase.from('jobs').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', jobId)
      }

      setLoading(false)
    }

    // --- Value setters that mark dirty ---
    const updateValue = useCallback((fieldId: string, val: string) => {
      setValues(prev => ({ ...prev, [fieldId]: val }))
      setIsDirty(true)
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
      const supabase = createClient()

      try {
        const upserts = Object.entries(values).map(([field_id, value]) => ({
          job_id: jobId, field_id, value, value_array: null,
        }))
        const arrayUpserts = Object.entries(arrayValues).map(([field_id, value_array]) => ({
          job_id: jobId, field_id, value: null, value_array,
        }))

        if (upserts.length > 0) {
          const { error } = await supabase
            .from('job_field_values')
            .upsert(upserts, { onConflict: 'job_id,field_id' })
          if (error) throw error
        }
        if (arrayUpserts.length > 0) {
          const { error } = await supabase
            .from('job_field_values')
            .upsert(arrayUpserts, { onConflict: 'job_id,field_id' })
          if (error) throw error
        }
        for (const [field_id, signature_data] of Object.entries(signatures)) {
          if (!signature_data) continue
          const { error } = await supabase
            .from('job_signatures')
            .upsert({ job_id: jobId, field_id, signature_data, signed_at: new Date().toISOString() },
              { onConflict: 'job_id,field_id' })
          if (error) throw error
        }

        setLastSaved(new Date())
        setIsDirty(false)
        return true
      } catch (err: any) {
        setSaveError(err.message ?? 'Save failed — please try again')
        return false
      } finally {
        setSaving(false)
      }
    }, [jobId, values, arrayValues, signatures])

    // --- Submit ---
    async function handleSubmit() {
      setSubmitting(true)

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
        setSaveError(`Required fields not completed: ${missing.join(', ')}`)
        setSubmitting(false)
        setShowSubmitDialog(false)
        return
      }

      const saved = await handleSave()
      if (!saved) {
        setSubmitting(false)
        setShowSubmitDialog(false)
        return
      }

      const supabase = createClient()
      const { error } = await supabase.from('jobs').update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      }).eq('id', jobId)

      if (error) {
        setSaveError('Submit failed: ' + error.message)
        setSubmitting(false)
        setShowSubmitDialog(false)
        return
      }

      router.push(backHref)
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
      const ok = await handleSave()
      if (ok && leaveDestination) router.push(leaveDestination)
      setShowLeaveDialog(false)
    }

    function confirmLeaveWithout() {
      setIsDirty(false)
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
      setFieldPhotos(prev => ({ ...prev, [fieldId]: fresh ?? [] }))
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
      setGeneralPhotos(fresh ?? [])
      setUploadingField(null)
    }

    async function deletePhoto(photoId: string, storagePath: string, fieldId?: string | null) {
      const supabase = createClient()
      const { error: storErr } = await supabase.storage.from('job-photos').remove([storagePath])
      if (storErr) { setSaveError('Delete failed: ' + storErr.message); return }
      const { error: dbErr } = await supabase.from('job_photos').delete().eq('id', photoId)
      if (dbErr) { setSaveError('Delete record failed: ' + dbErr.message); return }

      if (fieldId) {
        setFieldPhotos(prev => ({ ...prev, [fieldId]: (prev[fieldId] ?? []).filter(p => p.id !== photoId) }))
      } else {
        setGeneralPhotos(prev => prev.filter(p => p.id !== photoId))
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

    const isSubmitted = ['submitted', 'completed', 'client_visible'].includes(job.status)
    const readOnly = isSubmitted

    return (
      <div className="space-y-5 pb-10">
        {/* Top action bar */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="page-title truncate">{job.title}</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-gray-500">{job.job_number}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getJobStatusColor(job.status)}`}>
                {getJobStatusLabel(job.status)}
              </span>
              {lastSaved && !isDirty && (
                <span className="text-xs text-gray-400">Saved {lastSaved.toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {isDirty && (
                <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-secondary"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
            </div>
          )}
        </div>

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
                        value={values[field.id] ?? ''}
                        valueArray={arrayValues[field.id]}
                        signature={signatures[field.id]}
                        allValues={values}
                        onChange={v => updateValue(field.id, v)}
                        onArrayChange={v => updateArrayValue(field.id, v)}
                        onSignatureChange={data => updateSignature(field.id, data)}
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
                <button onClick={() => setShowSubmitDialog(true)} disabled={saving} className="btn-primary">
                  <Send className="h-4 w-4" />Submit
                </button>
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
          onClose={() => setShowSubmitDialog(false)}
          onConfirm={handleSubmit}
          title="Submit Checklist"
          message="Once submitted you will not be able to edit the checklist. Make sure all required fields are completed."
          confirmLabel="Submit Checklist"
          loading={submitting}
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
              <div className="flex flex-col gap-2">
                <button
                  onClick={confirmLeaveWithSave}
                  disabled={saving}
                  className="btn-primary justify-center"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save and leave
                </button>
                <button onClick={confirmLeaveWithout} className="btn-secondary justify-center text-red-600 hover:bg-red-50 border-red-200">
                  Leave without saving
                </button>
                <button onClick={() => setShowLeaveDialog(false)} className="btn-ghost justify-center">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }
)

export default JobChecklistEditor
