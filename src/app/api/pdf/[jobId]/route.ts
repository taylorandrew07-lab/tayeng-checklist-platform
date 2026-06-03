import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient } from '@/lib/supabase/server'
import { JobPDF } from '@/lib/pdf/JobPDF'
import React from 'react'
import { checkConditionalLogic } from '@/lib/utils'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { jobId } = await params

  // Authorization check
  let canAccess = false
  if (profile?.role === 'admin') {
    canAccess = true
  } else if (profile?.role === 'surveyor') {
    const { data: job } = await supabase.from('jobs').select('assigned_to').eq('id', jobId).single()
    canAccess = job?.assigned_to === user.id
  } else if (profile?.role === 'client') {
    const { data: clientLink } = await supabase.from('client_users').select('client_id').eq('profile_id', user.id).single()
    if (clientLink) {
      const { data: perm } = await supabase
        .from('client_job_permissions')
        .select('can_view_pdf')
        .eq('job_id', jobId)
        .eq('client_id', clientLink.client_id)
        .single()
      canAccess = perm?.can_view_pdf === true
    }
  }

  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Load all job data
  const [
    { data: job },
    { data: sections },
    { data: fieldValues },
    { data: signatureData },
    { count: photoCount },
  ] = await Promise.all([
    supabase.from('jobs').select(`
      *,
      template:checklist_templates(name),
      client:clients(name),
      assignee:profiles!jobs_assigned_to_fkey(full_name)
    `).eq('id', jobId).single(),
    supabase.from('template_sections')
      .select('*, fields:template_fields(*)')
      .eq('template_id', (await supabase.from('jobs').select('template_id').eq('id', jobId).single()).data?.template_id ?? '')
      .order('order_index'),
    supabase.from('job_field_values').select('*').eq('job_id', jobId),
    supabase.from('job_signatures').select('*').eq('job_id', jobId),
    supabase.from('job_photos').select('id', { count: 'exact', head: true }).eq('job_id', jobId),
  ])

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  // Build value maps
  const vals: Record<string, string> = {}
  const arrayVals: Record<string, string[]> = {}
  for (const v of (fieldValues ?? [])) {
    if (v.value_array) arrayVals[v.field_id] = v.value_array
    else vals[v.field_id] = v.value ?? ''
  }

  const sigs: Record<string, string> = {}
  for (const sig of (signatureData ?? [])) {
    sigs[sig.field_id] = sig.signature_data
  }

  // Process sections — sort and evaluate conditional logic
  const processedSections = (sections ?? []).map((s: any) => ({
    ...s,
    fields: [...(s.fields ?? [])]
      .sort((a: any, b: any) => a.order_index - b.order_index)
      .filter((f: any) => {
        // For PDF, include all visible fields
        if (!f.conditional_logic) return true
        return checkConditionalLogic(f.conditional_logic, vals)
      }),
  })).filter((s: any) => {
    if (!s.conditional_logic) return true
    return checkConditionalLogic(s.conditional_logic, vals)
  })

  // Render PDF
  const pdfBuffer = await renderToBuffer(
    React.createElement(JobPDF, {
      job,
      sections: processedSections,
      fieldValues: vals,
      arrayValues: arrayVals,
      signatures: sigs,
      photoCount: photoCount ?? 0,
    }) as any
  )

  const filename = `${job.job_number ?? 'job'}_${job.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
