'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Edit, Loader2, FileText, CheckSquare, AlignLeft, Hash, Type, Calendar, Clock, List, Camera, PenLine, Minus } from 'lucide-react'

const FIELD_TYPE_ICONS: Record<string, React.ElementType> = {
  text: Type,
  number: Hash,
  date: Calendar,
  time: Clock,
  dropdown: List,
  yes_no: CheckSquare,
  yes_no_na: CheckSquare,
  multiple_choice: List,
  textarea: AlignLeft,
  calculated: Hash,
  photo: Camera,
  signature: PenLine,
  heading: Type,
  divider: Minus,
}

const FIELD_TYPE_LABELS: Record<string, string> = {
  text: 'Text', number: 'Number', date: 'Date', time: 'Time',
  dropdown: 'Dropdown', yes_no: 'Yes / No', yes_no_na: 'Yes / No / N/A',
  multiple_choice: 'Multiple Choice', textarea: 'Text Area',
  calculated: 'Calculated', photo: 'Photo', signature: 'Signature',
  heading: 'Heading', divider: 'Divider',
}

export default function TemplatePreviewPage() {
  const params = useParams()
  const templateId = params.id as string
  const [template, setTemplate] = useState<any>(null)
  const [sections, setSections] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const [{ data: tmpl }, { data: sects }] = await Promise.all([
        supabase.from('checklist_templates').select('*, creator:profiles!checklist_templates_created_by_fkey(full_name)').eq('id', templateId).single(),
        supabase.from('template_sections')
          .select('*, fields:template_fields(*)')
          .eq('template_id', templateId)
          .order('order_index'),
      ])
      if (tmpl) setTemplate(tmpl)
      if (sects) {
        setSections(sects.map(s => ({
          ...s,
          fields: (s.fields ?? []).sort((a: any, b: any) => a.order_index - b.order_index),
        })))
      }
      setLoading(false)
    }
    load()
  }, [templateId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (!template) return <div className="text-center py-20 text-gray-400">Template not found.</div>

  const totalFields = sections.reduce((n, s) => n + (s.fields?.length ?? 0), 0)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/templates" className="btn-ghost py-2 px-3">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{template.name}</h1>
          <p className="text-gray-500 mt-0.5 text-sm">
            v{template.version} · {template.creator?.full_name} · {sections.length} section{sections.length !== 1 ? 's' : ''} · {totalFields} field{totalFields !== 1 ? 's' : ''}
          </p>
        </div>
        <Link href={`/admin/templates/${templateId}/edit`} className="btn-secondary">
          <Edit className="h-4 w-4" />Edit Template
        </Link>
      </div>

      {/* PDF-style preview */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="bg-brand-900 px-8 py-6 text-white">
          <div className="flex items-center gap-3 mb-4">
            <img src="/logo-full.jpeg" alt="Taylor Engineering" className="h-12 w-auto rounded-md" />
          </div>
          <h2 className="text-2xl font-bold">{template.name}</h2>
          {template.description && <p className="text-brand-300 mt-1">{template.description}</p>}
          <div className="grid grid-cols-3 gap-4 mt-6 border-t border-brand-700 pt-4">
            <div>
              <p className="text-brand-400 text-xs uppercase tracking-wide">Vessel</p>
              <p className="text-brand-100 text-sm mt-0.5">M.V. ________________</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs uppercase tracking-wide">Surveyor</p>
              <p className="text-brand-100 text-sm mt-0.5">____________________</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs uppercase tracking-wide">Date</p>
              <p className="text-brand-100 text-sm mt-0.5">DD-MM-YYYY</p>
            </div>
          </div>
        </div>

        {/* Sections */}
        <div className="divide-y divide-gray-200">
          {sections.length === 0 ? (
            <div className="px-8 py-10 text-center text-gray-400">
              No sections yet. <Link href={`/admin/templates/${templateId}/edit`} className="text-brand-600 hover:underline">Add sections in the editor →</Link>
            </div>
          ) : sections.map((section, si) => (
            <div key={section.id}>
              <div className="bg-gray-50 px-8 py-3 border-b border-gray-200">
                <h3 className="font-semibold text-gray-900 text-sm uppercase tracking-wide">
                  {si + 1}. {section.title}
                </h3>
                {section.description && <p className="text-xs text-gray-500 mt-0.5">{section.description}</p>}
              </div>
              <div className="divide-y divide-gray-100">
                {(section.fields ?? []).map((field: any, fi: number) => {
                  if (field.field_type === 'divider') {
                    return <div key={field.id} className="px-8 py-2"><hr className="border-gray-300" /></div>
                  }
                  if (field.field_type === 'heading') {
                    return (
                      <div key={field.id} className="px-8 py-3 bg-gray-50">
                        <p className="font-semibold text-gray-800">{field.label}</p>
                      </div>
                    )
                  }

                  const Icon = FIELD_TYPE_ICONS[field.field_type] ?? FileText

                  return (
                    <div key={field.id} className="px-8 py-4 flex items-start gap-4">
                      <div className="flex-shrink-0 w-8 text-right">
                        <span className="text-xs text-gray-400 font-mono">
                          {field.item_number || `${si + 1}.${fi + 1}`}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm font-medium text-gray-900">{field.label}</p>
                          {field.is_required && <span className="text-red-500 text-xs">*</span>}
                          {field.with_remarks && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">+Remarks</span>
                          )}
                        </div>
                        {field.help_text && <p className="text-xs text-gray-500 mb-2">{field.help_text}</p>}

                        {/* Field preview */}
                        {(field.field_type === 'yes_no' || field.field_type === 'yes_no_na') && (() => {
                          const COLOR_PREVIEW: Record<string, string> = {
                            green: 'border-green-300 bg-green-50 text-green-700',
                            red: 'border-red-300 bg-red-50 text-red-700',
                            gray: 'border-gray-300 bg-gray-50 text-gray-600',
                            amber: 'border-amber-300 bg-amber-50 text-amber-700',
                          }
                          const DEFAULT_COLORS: Record<string, string> = { yes: 'green', no: 'red', na: 'gray' }
                          const previewOpts = field.field_type === 'yes_no_na'
                            ? [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'na', label: 'N/A' }]
                            : [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
                          return (
                            <div className="flex gap-2 mt-1">
                              {previewOpts.map(opt => {
                                const color = (field.options?.find((o: any) => o.value === opt.value)?.color) ?? DEFAULT_COLORS[opt.value] ?? 'gray'
                                return (
                                  <div key={opt.value} className={`border-2 rounded-lg px-4 py-1.5 text-sm ${COLOR_PREVIEW[color] ?? COLOR_PREVIEW.gray}`}>
                                    {opt.label}
                                  </div>
                                )
                              })}
                            </div>
                          )
                        })()}
                        {(field.field_type === 'text' || field.field_type === 'number' || field.field_type === 'date' || field.field_type === 'time') && (
                          <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-xs text-gray-400 mt-1">
                            {field.placeholder || FIELD_TYPE_LABELS[field.field_type]}
                            {field.unit && <span className="ml-1 text-gray-500">({field.unit})</span>}
                          </div>
                        )}
                        {field.field_type === 'textarea' && (
                          <div className="border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-xs text-gray-400 mt-1 h-16">
                            {field.placeholder || 'Long text…'}
                          </div>
                        )}
                        {(field.field_type === 'dropdown' || field.field_type === 'multiple_choice') && field.options?.length > 0 && (
                          <div className="mt-1 space-y-1">
                            {field.options.map((opt: any) => (
                              <div key={opt.value} className="flex items-center gap-2 text-xs text-gray-600">
                                <div className="w-3 h-3 rounded-sm border border-gray-300" />
                                {opt.label}
                              </div>
                            ))}
                          </div>
                        )}
                        {field.field_type === 'signature' && (
                          <div className="border border-dashed border-gray-300 rounded-lg h-16 flex items-center justify-center mt-1">
                            <span className="text-xs text-gray-400">Signature</span>
                          </div>
                        )}
                        {field.field_type === 'photo' && (
                          <div className="border border-dashed border-gray-300 rounded-lg h-16 flex items-center justify-center mt-1">
                            <span className="text-xs text-gray-400">Photo upload</span>
                          </div>
                        )}
                        {field.with_remarks && (
                          <div className="mt-2">
                            <p className="text-xs text-gray-500 mb-1">Remarks:</p>
                            <div className="border border-gray-200 rounded-lg px-3 py-1.5 bg-gray-50 text-xs text-gray-400 h-8" />
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0">
                        <span className="text-xs text-gray-300 bg-gray-50 px-1.5 py-0.5 rounded">
                          {FIELD_TYPE_LABELS[field.field_type]}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="bg-gray-50 px-8 py-4 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
          <span>Taylor Engineering Agencies Limited</span>
          <span>Version {template.version}</span>
        </div>
      </div>
    </div>
  )
}
