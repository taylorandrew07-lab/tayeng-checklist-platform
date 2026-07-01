'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import TemplateBuilder from '@/components/template-builder/TemplateBuilder'
import ColorSwatchPicker from '@/components/ui/ColorSwatchPicker'
import type { BuilderSection } from '@/components/template-builder/types'
import { Save, ArrowLeft, Loader2, AlertTriangle } from 'lucide-react'
import type { TemplateStatus } from '@/lib/types/database'
import { dirtyState } from '@/lib/dirty-state'
import { withTimeout } from '@/lib/utils'
import { useAutoSave } from '@/lib/useAutoSave'

export default function EditTemplatePage() {
  const router = useRouter()
  const params = useParams()
  const templateId = params.id as string

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TemplateStatus>('draft')
  const [allowSurveyorStart, setAllowSurveyorStart] = useState(false)
  const [pdfIncludePhotos, setPdfIncludePhotos] = useState(false)
  const [pdfHideLogo, setPdfHideLogo] = useState(false)
  const [pdfDisclaimer, setPdfDisclaimer] = useState('')
  const [pdfPreamble, setPdfPreamble] = useState('')
  const [color, setColor] = useState<string | null>(null)
  const [sections, setSections] = useState<BuilderSection[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [jobCount, setJobCount] = useState(0)
  const [isDirty, setIsDirty] = useState(false)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [leaveDestination, setLeaveDestination] = useState<string | null>(null)
  const [leaveError, setLeaveError] = useState<string | null>(null)

  // Track original DB IDs so we can update in place
  const originalSectionIds = useRef<Set<string>>(new Set())
  const originalFieldIds = useRef<Set<string>>(new Set())
  const loadedRef = useRef(false)
  // One-time skip: suppress the dirty effect triggered by the initial state hydration
  const skipDirtyRef = useRef(false)

  // Mark dirty only after initial load, skipping the hydration batch
  useEffect(() => {
    if (!loadedRef.current) return
    if (skipDirtyRef.current) { skipDirtyRef.current = false; return }
    setIsDirty(true)
  }, [name, description, status, allowSurveyorStart, pdfIncludePhotos, pdfHideLogo, pdfDisclaimer, pdfPreamble, color, sections])

  // Sync to global dirty-state so sidebar links respect it
  useEffect(() => {
    dirtyState.set(isDirty)
    dirtyState.setHandler(isDirty ? requestNavigate : null)
  }, [isDirty]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { return () => { dirtyState.set(false); dirtyState.setHandler(null) } }, [])

  // Warn on browser close when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // Auto-save edits (debounced) — no need to press Save. handleSave upserts by id
  // and re-baselines, so repeated saves are safe and it clears isDirty (no loop).
  // Stays on the page (redirectTo: null). A validation error just surfaces and waits.
  useAutoSave(
    () => { if (isDirty && !saving) handleSave({ redirectTo: null }) },
    [name, description, status, allowSurveyorStart, pdfIncludePhotos, pdfHideLogo, pdfDisclaimer, pdfPreamble, color, sections, isDirty],
    { enabled: !loading },
  )

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data: tmpl }, { count }] = await Promise.all([
        supabase
          .from('checklist_templates')
          .select('*, sections:template_sections(*, fields:template_fields(*))')
          .eq('id', templateId)
          .single(),
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('template_id', templateId),
      ])

      if (!tmpl) { router.push('/admin/templates'); return }

      setName(tmpl.name)
      setDescription(tmpl.description ?? '')
      setStatus(tmpl.status)
      setAllowSurveyorStart(tmpl.allow_surveyor_start)
      setPdfIncludePhotos(tmpl.pdf_include_photos ?? false)
      setPdfHideLogo(tmpl.pdf_hide_logo ?? false)
      setPdfDisclaimer(tmpl.pdf_disclaimer ?? '')
      setPdfPreamble(tmpl.pdf_preamble ?? '')
      setColor(tmpl.color ?? null)
      setJobCount(count ?? 0)

      const secIds = new Set<string>()
      const fieldIds = new Set<string>()

      const builtSections: BuilderSection[] = (tmpl.sections ?? [])
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .map((s: any) => {
          secIds.add(s.id)
          return {
            id: s.id,
            title: s.title,
            description: s.description ?? '',
            order_index: s.order_index,
            conditional_logic: s.conditional_logic,
            is_repeatable: s.is_repeatable ?? false,
            fields: (s.fields ?? [])
              .sort((a: any, b: any) => a.order_index - b.order_index)
              .map((f: any) => {
                fieldIds.add(f.id)
                return {
                  id: f.id,
                  label: f.label,
                  field_type: f.field_type,
                  order_index: f.order_index,
                  is_required: f.is_required,
                  options: f.options ?? [],
                  validation: f.validation ?? {},
                  calculation_formula: f.calculation_formula ?? '',
                  conditional_logic: f.conditional_logic,
                  help_text: f.help_text ?? '',
                  unit: f.unit ?? '',
                  item_number: f.item_number ?? '',
                  with_remarks: f.with_remarks ?? false,
                  is_billable_hours: f.is_billable_hours ?? false,
                }
              }),
          }
        })

      originalSectionIds.current = secIds
      originalFieldIds.current = fieldIds
      skipDirtyRef.current = true
      setSections(builtSections)
      setLoading(false)
      loadedRef.current = true
    }
    load()
  }, [templateId, router])

  // handleSave: returns { ok, errorMsg } so callers never read stale React state.
  // redirectTo: where to navigate on success. undefined = /admin/templates, null = stay here.
  async function handleSave(opts?: { redirectTo?: string | null }): Promise<{ ok: boolean; errorMsg?: string }> {
    const fail = (m: string) => { setError(m); return { ok: false, errorMsg: m } }

    if (!name.trim()) return fail('Template name is required')

    // Validate: no broken conditional/formula references
    const allFieldIds = new Set(sections.flatMap(s => s.fields.map(f => f.id)))
    const broken: string[] = []
    for (const section of sections) {
      if (section.conditional_logic) {
        for (const c of section.conditional_logic.conditions) {
          if (c.field_id && !allFieldIds.has(c.field_id)) broken.push(`Section "${section.title}" condition → missing field`)
        }
      }
      for (const field of section.fields) {
        if (field.conditional_logic) {
          for (const c of field.conditional_logic.conditions) {
            if (c.field_id && !allFieldIds.has(c.field_id)) broken.push(`"${field.label}" condition → missing field`)
          }
        }
        if (field.calculation_formula) {
          const refs = Array.from(field.calculation_formula.matchAll(/\{([^}]+)\}/g)).map(m => m[1])
          for (const r of refs) {
            if (!allFieldIds.has(r)) broken.push(`"${field.label}" formula → missing field {${r}}`)
          }
        }
      }
    }
    if (broken.length > 0) return fail(`Cannot save — broken references:\n• ${broken.join('\n• ')}`)

    setSaving(true)
    setError(null)

    const supabase = createClient()

    // Compute removed items up front (original ids no longer present in the builder).
    const currentSectionIds = new Set(sections.map(s => s.id))
    const currentFieldIds = new Set(sections.flatMap(s => s.fields.map(f => f.id)))
    const removedSectionIds = Array.from(originalSectionIds.current).filter(id => !currentSectionIds.has(id))
    const removedFieldIds = Array.from(originalFieldIds.current).filter(id => !currentFieldIds.has(id))

    // The builder assigns a real UUID to every section/field (new and existing),
    // so the whole template persists in a handful of bulk calls — no per-row
    // round-trips and no id remapping (conditional logic already references UUIDs).
    // Everything below runs inside try/catch so any failure clears the Saving state.
    try {
      // Guard against destroying existing answers via cascade — before any writes.
      if (removedFieldIds.length > 0 && jobCount > 0) {
        const { count: answerCount } = await withTimeout(
          supabase.from('job_field_values').select('id', { count: 'exact', head: true }).in('field_id', removedFieldIds),
          15_000, 'Checking existing answers'
        )
        if ((answerCount ?? 0) > 0) {
          setError(`Cannot delete fields that have existing answers (${answerCount} answer record${answerCount !== 1 ? 's' : ''} would be lost). Remove from the checklist answers first, or duplicate the template instead.`)
          setSaving(false)
          return { ok: false }
        }
      }

      const { error: tmplErr } = await withTimeout(
        supabase.from('checklist_templates').update({
          name: name.trim(),
          description: description.trim() || null,
          status,
          allow_surveyor_start: allowSurveyorStart,
          pdf_include_photos: pdfIncludePhotos,
          pdf_hide_logo: pdfHideLogo,
          pdf_disclaimer: pdfDisclaimer.trim() || null,
          pdf_preamble: pdfPreamble.trim() || null,
          color,
        }).eq('id', templateId),
        15_000, 'Saving template'
      )
      if (tmplErr) throw tmplErr

      const sectionRows = sections.map(s => ({
        id: s.id,
        template_id: templateId,
        title: s.title,
        description: s.description || null,
        order_index: s.order_index,
        conditional_logic: s.conditional_logic,
        is_repeatable: s.is_repeatable ?? false,
      }))
      if (sectionRows.length > 0) {
        const { error } = await withTimeout(
          supabase.from('template_sections').upsert(sectionRows, { onConflict: 'id' }),
          20_000, 'Saving sections'
        )
        if (error) throw error
      }

      const fieldRows = sections.flatMap(s => s.fields.map(f => ({
        id: f.id,
        template_id: templateId,
        section_id: s.id,
        label: f.label,
        field_type: f.field_type,
        order_index: f.order_index,
        is_required: f.is_required,
        options: f.options.length ? f.options : null,
        validation: Object.keys(f.validation).length ? f.validation : null,
        calculation_formula: f.calculation_formula || null,
        conditional_logic: f.conditional_logic,
        help_text: f.help_text || null,
        unit: f.unit || null,
        item_number: f.item_number || null,
        with_remarks: f.with_remarks || false,
        is_billable_hours: f.field_type === 'calculated' ? f.is_billable_hours || false : false,
      })))
      if (fieldRows.length > 0) {
        const { error } = await withTimeout(
          supabase.from('template_fields').upsert(fieldRows, { onConflict: 'id' }),
          20_000, 'Saving fields'
        )
        if (error) throw error
      }

      // Delete removed items AFTER the upserts, so a field moved out of a deleted
      // section (now pointing at its new section) is not lost to the cascade.
      if (removedSectionIds.length > 0) {
        const { error } = await withTimeout(
          supabase.from('template_sections').delete().in('id', removedSectionIds),
          15_000, 'Removing deleted sections'
        )
        if (error) throw error
      }
      if (removedFieldIds.length > 0) {
        const { error } = await withTimeout(
          supabase.from('template_fields').delete().in('id', removedFieldIds),
          15_000, 'Removing deleted fields'
        )
        if (error) throw error
      }
    } catch (err: any) {
      setError(err?.message ?? 'Save failed — please try again')
      setSaving(false)
      return { ok: false, errorMsg: err?.message }
    }

    // The just-persisted items become the baseline so a subsequent save (without
    // leaving the page) correctly distinguishes new vs. removed items.
    originalSectionIds.current = currentSectionIds
    originalFieldIds.current = currentFieldIds

    setSaving(false)
    setIsDirty(false)
    dirtyState.set(false)
    dirtyState.setHandler(null)
    const dest = opts?.redirectTo !== undefined ? opts.redirectTo : '/admin/templates'
    if (dest) router.push(dest)
    return { ok: true }
  }

  function requestNavigate(dest: string) {
    if (isDirty) {
      setLeaveDestination(dest)
      setShowLeaveDialog(true)
    } else {
      router.push(dest)
    }
  }

  async function confirmLeaveWithSave() {
    setLeaveError(null)
    const dest = leaveDestination ?? '/admin/templates'
    const result = await handleSave({ redirectTo: dest })
    if (!result.ok) {
      // Use the error string returned directly — avoids reading stale React state
      setLeaveError(result.errorMsg ?? error ?? 'Save failed')
    } else {
      setShowLeaveDialog(false)
    }
  }

  function confirmLeaveWithout() {
    setIsDirty(false)
    setShowLeaveDialog(false)
    if (leaveDestination) router.push(leaveDestination)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => requestNavigate('/admin/templates')}
          className="btn-ghost py-2 px-3"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1">
          <h1 className="page-title">Edit Template</h1>
          <p className="text-gray-500 mt-0.5">{jobCount > 0 ? `${jobCount} job${jobCount !== 1 ? 's' : ''} using this template` : 'No jobs yet'}</p>
        </div>
        {isDirty && (
          <button onClick={() => handleSave({ redirectTo: null })} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        )}
      </div>

      {jobCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            This template is used by {jobCount} job{jobCount !== 1 ? 's' : ''}. Changes to fields may affect in-progress jobs. Consider duplicating instead of editing if jobs are active.
          </p>
        </div>
      )}

      <div className="card p-6 space-y-4">
        <h2 className="section-title">Template Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="label-base">Template Name *</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input-base" />
          </div>
          <div className="sm:col-span-2">
            <label className="label-base">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-base resize-none" rows={2} />
          </div>
          <div className="sm:col-span-2">
            <label className="label-base">Colour <span className="text-gray-400 font-normal">— used when colouring jobs by job type</span></label>
            <ColorSwatchPicker value={color} onChange={setColor} />
          </div>
          <div>
            <label className="label-base">Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TemplateStatus)} className="input-base">
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div className="flex items-center gap-3 pt-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setAllowSurveyorStart(!allowSurveyorStart)}
                className={`relative w-10 h-6 rounded-full transition-colors ${allowSurveyorStart ? 'bg-brand-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${allowSurveyorStart ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm font-medium text-gray-700">Allow surveyor start</span>
            </label>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setPdfIncludePhotos(!pdfIncludePhotos)}
                className={`relative w-10 h-6 rounded-full transition-colors ${pdfIncludePhotos ? 'bg-brand-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pdfIncludePhotos ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm font-medium text-gray-700">Include photos in the PDF report <span className="font-normal text-gray-400">— captioned grid, grouped by field</span></span>
            </label>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div
                onClick={() => setPdfHideLogo(!pdfHideLogo)}
                className={`relative w-10 h-6 rounded-full transition-colors ${pdfHideLogo ? 'bg-brand-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pdfHideLogo ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
              <span className="text-sm font-medium text-gray-700">Hide logo on the PDF report <span className="font-normal text-gray-400">— shows the company-name text header instead</span></span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">PDF preamble <span className="font-normal text-gray-400">— short intro printed below the Job Details on page 1 (leave blank for none)</span></label>
            <textarea
              value={pdfPreamble}
              onChange={e => setPdfPreamble(e.target.value)}
              rows={3}
              placeholder="e.g. Taylor Engineering attended the above vessel to carry out…"
              className="input-base text-sm resize-y"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">PDF disclaimer <span className="font-normal text-gray-400">— fixed boilerplate printed at the end of every report (leave blank for none)</span></label>
            <textarea
              value={pdfDisclaimer}
              onChange={e => setPdfDisclaimer(e.target.value)}
              rows={4}
              placeholder="e.g. This report remains the property of…"
              className="input-base text-sm resize-y"
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="section-title px-1">Template Fields</h2>
        <TemplateBuilder sections={sections} onChange={setSections} />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}

      <div className="flex items-center justify-end gap-3 pb-6">
        <button type="button" onClick={() => requestNavigate('/admin/templates')} className="btn-secondary">
          Cancel
        </button>
        <button onClick={() => handleSave({ redirectTo: null })} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Sticky bottom save bar */}
      {isDirty && (
        <div className="sticky bottom-4 z-10">
          <div className="card p-3 flex items-center justify-between shadow-lg gap-3 max-w-4xl mx-auto">
            <p className="text-xs text-amber-600 font-medium">Unsaved changes</p>
            <button onClick={() => handleSave({ redirectTo: null })} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Leave dialog */}
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
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 whitespace-pre-wrap">{leaveError}</div>
            )}
            <div className="flex flex-col gap-2">
              <button onClick={confirmLeaveWithSave} disabled={saving} className="btn-primary justify-center">
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
    </div>
  )
}
