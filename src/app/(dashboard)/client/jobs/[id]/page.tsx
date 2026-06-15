import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Lock } from 'lucide-react'
import { formatDate, checkConditionalLogic } from '@/lib/utils'
import { CLIENT_STATUS, clientStatusFor } from '@/lib/jobs/tracker'
import JobPdfButton from '@/components/job/JobPdfButton'

// Resolve {uuid} tokens in a label to the selected dropdown option label (or the
// live value of a deferred "Other" text field). Mirrors the editor/PDF resolvers.
function resolveLabel(label: string, values: Record<string, string>, allFields: any[]): string {
  return label.replace(/\{([0-9a-f-]{36})\}/gi, (_m, fieldId) => {
    const raw = values[fieldId] ?? ''
    const val = raw.includes('|||') ? raw.split('|||')[0] : raw
    if (!val) return ''
    const src = allFields.find((f: any) => f.id === fieldId)
    if (src?.field_type === 'dropdown') {
      const opt = (src.options ?? []).find((o: any) => o.value === val)
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

export default async function ClientJobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: clientLink } = await supabase
    .from('client_users')
    .select('client_id')
    .eq('profile_id', user.id)
    .single()

  if (!clientLink) redirect('/client')

  const clientId = clientLink.client_id

  // Verify permission
  const { data: perm } = await supabase
    .from('client_job_permissions')
    .select('*')
    .eq('job_id', id)
    .eq('client_id', clientId)
    .single()

  if (!perm) redirect('/client')

  // Load job
  const { data: job } = await supabase
    .from('jobs')
    .select(`
      *,
      template:checklist_templates(name, id),
      client:clients(name)
    `)
    .eq('id', id)
    .single()

  if (!job) redirect('/client')

  // Load checklist details if permitted
  let sections: any[] = []
  let fieldValues: Record<string, any> = {}
  let signatures: Record<string, string> = {}

  if (perm.can_view_checklist_details) {
    const [{ data: tmplSections }, { data: vals }, { data: sigs }] = await Promise.all([
      supabase.from('template_sections').select('*, fields:template_fields(*)').eq('template_id', job.template_id).order('order_index'),
      supabase.from('job_field_values').select('*').eq('job_id', id),
      supabase.from('job_signatures').select('*').eq('job_id', id),
    ])

    sections = (tmplSections ?? []).map((s: any) => ({
      ...s,
      fields: [...(s.fields ?? [])].sort((a: any, b: any) => a.order_index - b.order_index),
    }))

    for (const v of (vals ?? [])) {
      fieldValues[v.field_id] = v.value_array ?? v.value ?? ''
    }
    for (const sig of (sigs ?? [])) {
      signatures[sig.field_id] = sig.signature_data
    }
  }

  const allValues: Record<string, string> = Object.fromEntries(
    Object.entries(fieldValues).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])
  )

  const allFieldsFlat: any[] = sections.flatMap((s: any) => s.fields ?? [])

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/client" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{job.title}</h1>
          <p className="text-sm text-gray-500 mt-0.5">{job.job_number}</p>
        </div>
        {perm.can_view_pdf && !!job.submitted_at && (
          <JobPdfButton jobId={id} />
        )}
      </div>

      {/* Job summary */}
      <div className="card p-5">
        <h2 className="section-title mb-4">Job Summary</h2>
        <dl className="grid grid-cols-2 gap-4">
          {perm.can_view_status && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Status</dt>
              <dd className="mt-1">
                {(() => { const cs = CLIENT_STATUS[clientStatusFor(job.workflow_status)]; return (
                  <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${cs.pill}`}><span className={`h-1.5 w-1.5 rounded-full ${cs.dot}`} />{cs.label}</span>
                ) })()}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-medium text-gray-500">Template</dt>
            <dd className="mt-1 text-sm text-gray-900">{job.template?.name}</dd>
          </div>
          {job.scheduled_date && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Scheduled Date</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDate(job.scheduled_date)}</dd>
            </div>
          )}
          {job.submitted_at && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Submitted</dt>
              <dd className="mt-1 text-sm text-gray-900">{formatDate(job.submitted_at)}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Checklist details */}
      {perm.can_view_checklist_details && sections.length > 0 && (
        <div className="space-y-4">
          <h2 className="section-title">Checklist Details</h2>
          {sections.map((section: any) => {
            const visible = checkConditionalLogic(section.conditional_logic, allValues)
            if (!visible) return null
            return (
              <div key={section.id} className="card overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">{section.title}</h3>
                </div>
                <div className="p-5 space-y-4">
                  {section.fields.map((field: any) => {
                    if (['heading', 'divider', 'photo'].includes(field.field_type)) return null
                    const fieldVisible = checkConditionalLogic(field.conditional_logic, allValues)
                    if (!fieldVisible) return null

                    const rawVal = fieldValues[field.id]
                    const displayVal = Array.isArray(rawVal) ? rawVal.join(', ') : rawVal

                    return (
                      <div key={field.id}>
                        <p className="text-xs font-medium text-gray-500">{resolveLabel(field.label, allValues, allFieldsFlat)}</p>
                        {field.field_type === 'signature' ? (
                          signatures[field.id] ? (
                            <img
                              src={signatures[field.id]}
                              alt="Signature"
                              className="mt-1 h-16 border border-gray-200 rounded bg-white"
                            />
                          ) : (
                            <p className="text-sm text-gray-400 mt-1 italic">No signature</p>
                          )
                        ) : (field.field_type === 'yes_no' || field.field_type === 'yes_no_na') ? (() => {
                          const BADGE: Record<string,string> = { green:'bg-green-100 text-green-800', red:'bg-red-100 text-red-800', gray:'bg-gray-100 text-gray-600', amber:'bg-amber-100 text-amber-800' }
                          const answerPart = (displayVal || '').includes('|||') ? (displayVal || '').split('|||')[0] : (displayVal || '')
                          const remarksPart = (displayVal || '').includes('|||') ? (displayVal || '').split('|||')[1] : ''
                          const optColor = (field.options ?? []).find((o: any) => o.value === answerPart)?.color
                          const fallback = answerPart === 'yes' ? 'green' : answerPart === 'no' ? 'red' : 'gray'
                          const cls = BADGE[optColor ?? fallback] ?? BADGE.gray
                          return answerPart ? (
                            <div className="mt-1 space-y-1">
                              <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}>{answerPart.toUpperCase()}</span>
                              {remarksPart && <p className="text-sm text-gray-600 italic">{remarksPart}</p>}
                            </div>
                          ) : <p className="text-sm text-gray-400 mt-1">—</p>
                        })() : (
                          <p className="text-sm text-gray-900 mt-1">{displayVal || '—'}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!perm.can_view_checklist_details && !perm.can_view_pdf && (
        <div className="card py-12 text-center">
          <Lock className="h-10 w-10 mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">You have access to view this job&apos;s status only. Contact your account manager for additional access.</p>
        </div>
      )}
    </div>
  )
}
