'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import {
  ArrowLeft, Loader2, Save, Send, Download, Camera, X, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp
} from 'lucide-react'
import { formatDate, checkConditionalLogic, getJobStatusLabel, getJobStatusColor } from '@/lib/utils'
import FieldRenderer from '@/components/job/FieldRenderer'
import type { TemplateField, TemplateSection, JobFieldValue, JobSignature } from '@/lib/types/database'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface SectionWithFields extends TemplateSection {
  fields: TemplateField[]
}

export default function SurveyorJobPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.id as string

  const [job, setJob] = useState<any>(null)
  const [sections, setSections] = useState<SectionWithFields[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [arrayValues, setArrayValues] = useState<Record<string, string[]>>({})
  const [signatures, setSignatures] = useState<Record<string, string>>({})
  const [photos, setPhotos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [showSubmitDialog, setShowSubmitDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)

  useEffect(() => { load() }, [jobId])

  async function load() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const [{ data: jobData }, { data: sectData }, { data: valData }, { data: sigData }, { data: photoData }] = await Promise.all([
      supabase.from('jobs').select(`
        *,
        template:checklist_templates(name, id),
        client:clients(name)
      `).eq('id', jobId).eq('assigned_to', user.id).single(),
      supabase.from('template_sections').select('*, fields:template_fields(*)').eq('template_id', '').maybeSingle(),
      supabase.from('job_field_values').select('*').eq('job_id', jobId),
      supabase.from('job_signatures').select('*').eq('job_id', jobId),
      supabase.from('job_photos').select('*').eq('job_id', jobId),
    ])

    if (!jobData) { router.push('/surveyor'); return }

    // Load template sections/fields
    const { data: tmplSections } = await supabase
      .from('template_sections')
      .select('*, fields:template_fields(*)')
      .eq('template_id', jobData.template_id)
      .order('order_index')

    const processedSections: SectionWithFields[] = (tmplSections ?? []).map((s: any) => ({
      ...s,
      fields: [...(s.fields ?? [])].sort((a: any, b: any) => a.order_index - b.order_index),
    }))

    // Populate values
    const vals: Record<string, string> = {}
    const arrVals: Record<string, string[]> = {}
    for (const v of (valData ?? [])) {
      if (v.value_array) arrVals[v.field_id] = v.value_array
      else vals[v.field_id] = v.value ?? ''
    }

    // Populate default values for empty fields
    for (const section of processedSections) {
      for (const field of section.fields) {
        if (field.default_value && !vals[field.id] && !arrVals[field.id]) {
          vals[field.id] = field.default_value
        }
      }
    }

    const sigs: Record<string, string> = {}
    for (const sig of (sigData ?? [])) {
      sigs[sig.field_id] = sig.signature_data
    }

    setJob(jobData)
    setSections(processedSections)
    setValues(vals)
    setArrayValues(arrVals)
    setSignatures(sigs)
    setPhotos(photoData ?? [])

    // Update status to in_progress if assigned
    if (jobData.status === 'assigned') {
      await supabase.from('jobs').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', jobId)
    }

    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    const supabase = createClient()

    try {
      // Upsert all field values
      const upserts = Object.entries(values).map(([field_id, value]) => ({
        job_id: jobId,
        field_id,
        value,
        value_array: null,
      }))
      const arrayUpserts = Object.entries(arrayValues).map(([field_id, value_array]) => ({
        job_id: jobId,
        field_id,
        value: null,
        value_array,
      }))

      if (upserts.length > 0) {
        await supabase.from('job_field_values').upsert(upserts, { onConflict: 'job_id,field_id' })
      }
      if (arrayUpserts.length > 0) {
        await supabase.from('job_field_values').upsert(arrayUpserts, { onConflict: 'job_id,field_id' })
      }

      // Upsert signatures
      for (const [field_id, signature_data] of Object.entries(signatures)) {
        if (signature_data) {
          await supabase.from('job_signatures').upsert({
            job_id: jobId,
            field_id,
            signature_data,
            signed_at: new Date().toISOString(),
          }, { onConflict: 'job_id,field_id' })
        }
      }

      setLastSaved(new Date())
    } catch (err: any) {
      setError(err.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)

    // Validate required fields
    const missingRequired: string[] = []
    for (const section of sections) {
      const sectionVisible = checkConditionalLogic(section.conditional_logic, values)
      if (!sectionVisible) continue
      for (const field of section.fields) {
        if (!field.is_required) continue
        const fieldVisible = checkConditionalLogic(field.conditional_logic, values)
        if (!fieldVisible) continue
        if (field.field_type === 'signature' && !signatures[field.id]) {
          missingRequired.push(field.label)
        } else if (field.field_type === 'multiple_choice' && (!arrayValues[field.id] || arrayValues[field.id].length === 0)) {
          missingRequired.push(field.label)
        } else if (!['signature', 'multiple_choice', 'photo', 'heading', 'divider', 'calculated'].includes(field.field_type) && !values[field.id]) {
          missingRequired.push(field.label)
        }
      }
    }

    if (missingRequired.length > 0) {
      setError(`Please complete required fields: ${missingRequired.join(', ')}`)
      setSubmitting(false)
      setShowSubmitDialog(false)
      return
    }

    await handleSave()

    const supabase = createClient()
    await supabase.from('jobs').update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    }).eq('id', jobId)

    setShowSubmitDialog(false)
    setSubmitting(false)
    router.push('/surveyor')
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploadingPhoto(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    for (const file of Array.from(files)) {
      const path = `${jobId}/${Date.now()}_${file.name}`
      const { error: uploadErr } = await supabase.storage.from('job-photos').upload(path, file)
      if (uploadErr) continue

      await supabase.from('job_photos').insert({
        job_id: jobId,
        storage_path: path,
        filename: file.name,
        uploaded_by: user.id,
      })
    }

    // Reload photos
    const { data: photoData } = await supabase.from('job_photos').select('*').eq('job_id', jobId)
    setPhotos(photoData ?? [])
    setUploadingPhoto(false)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    const supabase = createClient()
    await supabase.storage.from('job-photos').remove([storagePath])
    await supabase.from('job_photos').delete().eq('id', photoId)
    setPhotos(photos.filter(p => p.id !== photoId))
  }

  function toggleSection(sectionId: string) {
    setCollapsedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
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
    <div className="max-w-3xl mx-auto space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/surveyor" className="btn-ghost py-2 px-3">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{job.title}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-sm text-gray-500">{job.job_number}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getJobStatusColor(job.status)}`}>
              {getJobStatusLabel(job.status)}
            </span>
          </div>
        </div>
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
          {job.scheduled_date && (
            <div>
              <p className="text-xs font-medium text-brand-600">Scheduled</p>
              <p className="text-gray-900">{formatDate(job.scheduled_date)}</p>
            </div>
          )}
        </div>
      </div>

      {isSubmitted && (
        <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 p-4">
          <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800">Job submitted</p>
            <p className="text-xs text-green-600">This job has been submitted and is read-only.</p>
          </div>
          <button
            onClick={() => window.open(`/api/pdf/${jobId}`, '_blank')}
            className="btn-secondary text-xs py-1.5 px-3"
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-3">
          <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Checklist sections */}
      {sections.map(section => {
        const sectionVisible = checkConditionalLogic(section.conditional_logic, values)
        if (!sectionVisible) return null

        const collapsed = collapsedSections.has(section.id)
        const completedCount = section.fields.filter(f => {
          if (['heading', 'divider', 'photo'].includes(f.field_type)) return true
          if (f.field_type === 'signature') return !!signatures[f.id]
          if (f.field_type === 'multiple_choice') return (arrayValues[f.id] ?? []).length > 0
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
                <span className="text-xs text-gray-500">
                  {completedCount}/{section.fields.filter(f => !['heading', 'divider'].includes(f.field_type)).length} fields
                </span>
                {collapsed ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronUp className="h-4 w-4 text-gray-400" />}
              </div>
            </button>

            {!collapsed && (
              <div className="p-5 space-y-5">
                {section.fields.map(field => (
                  <FieldRenderer
                    key={field.id}
                    field={field}
                    value={values[field.id] ?? ''}
                    valueArray={arrayValues[field.id]}
                    signature={signatures[field.id]}
                    allValues={values}
                    onChange={(v) => setValues(prev => ({ ...prev, [field.id]: v }))}
                    onArrayChange={(v) => setArrayValues(prev => ({ ...prev, [field.id]: v }))}
                    onSignatureChange={(data) => setSignatures(prev => ({ ...prev, [field.id]: data }))}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Photos section */}
      {!readOnly && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="section-title">Photos</h2>
              <p className="text-xs text-gray-500 mt-0.5">Photos are stored internally and not included in the exported PDF by default.</p>
            </div>
            <button
              onClick={() => photoInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="btn-secondary text-sm"
            >
              {uploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              Upload
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handlePhotoUpload}
            />
          </div>

          {photos.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {photos.map(photo => (
                <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group">
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500 p-1 text-center">
                    {photo.filename}
                  </div>
                  <button
                    onClick={() => deletePhoto(photo.id, photo.storage_path)}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              onClick={() => photoInputRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg py-8 text-center cursor-pointer hover:border-brand-300 transition-colors"
            >
              <Camera className="h-8 w-8 mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-500">Upload photos</p>
              <p className="text-xs text-gray-400">Click or tap to select photos</p>
            </div>
          )}
        </div>
      )}

      {/* Action bar */}
      {!readOnly && (
        <div className="sticky bottom-4 z-10">
          <div className="card p-3 flex items-center justify-between shadow-lg">
            <div>
              {lastSaved && (
                <p className="text-xs text-gray-500">
                  Saved {lastSaved.toLocaleTimeString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-secondary"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                onClick={() => setShowSubmitDialog(true)}
                className="btn-primary"
              >
                <Send className="h-4 w-4" />
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF download for read-only */}
      {readOnly && (
        <div className="flex justify-end">
          <button
            onClick={() => window.open(`/api/pdf/${jobId}`, '_blank')}
            className="btn-primary"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>
        </div>
      )}

      <ConfirmDialog
        open={showSubmitDialog}
        onClose={() => setShowSubmitDialog(false)}
        onConfirm={handleSubmit}
        title="Submit Job"
        message="Are you sure you want to submit this job? Once submitted, you will not be able to edit the checklist. Make sure all required fields are completed."
        confirmLabel="Submit Job"
        loading={submitting}
      />
    </div>
  )
}
