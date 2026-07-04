import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { JobPDF } from '@/lib/pdf/JobPDF'
import React from 'react'
import sharp from 'sharp'
import exifr from 'exifr'
import { checkConditionalLogic } from '@/lib/utils'
import { instanceKey } from '@/lib/offline/instanceKeys'

// Reports with many full-resolution photos take a while to render — give the function
// headroom so it completes instead of being cut off (which the client sees as a hang).
export const maxDuration = 60

export async function GET(
  request: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single()

  // Fail closed: a deactivated account keeps a valid session but must not be able
  // to pull full reports via the service-role render path below.
  if (!profile || profile.is_active !== true) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { jobId } = await params

  // Authorization check.
  // INVARIANT: an ACTIVE surveyor may edit, submit AND download ANY job — the same
  // rule across all three surfaces (checklist editor, the "Surveyors can update
  // jobs" RLS policy from migration 056, and this route). Keeping them identical is
  // what prevents the "looks editable / submits fine but won't download" class of
  // bug. is_active is already enforced above. Do NOT narrow this to assigned_to
  // without also narrowing the editor + the 056 UPDATE policy in lockstep.
  let canAccess = false
  if (profile?.role === 'admin') {
    canAccess = true
  } else if (profile?.role === 'surveyor') {
    canAccess = true
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

  // Authorization is complete above. Render the full report with the service
  // client so the PDF is complete for anyone allowed to download it — RLS detail
  // flags (e.g. can_view_checklist_details) gate the in-app view, not the PDF,
  // and "View PDF" permission means the client receives the complete report.
  const db = createServiceClient()

  // Load the job first (it carries template_id), then everything else in parallel
  // keyed off it — avoids a second jobs round-trip just to get template_id.
  const { data: job } = await db.from('jobs').select(`
      *,
      template:checklist_templates(name, pdf_include_photos, pdf_hide_logo, pdf_hide_client, pdf_hide_surveyor, pdf_disclaimer, pdf_preamble),
      client:clients(name),
      assignee:profiles!jobs_assigned_to_fkey(full_name)
    `).eq('id', jobId).single()

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const [
    { data: sections },
    { data: fieldValues },
    { data: signatureData },
    { data: photoData },
  ] = await Promise.all([
    db.from('template_sections')
      .select('*, fields:template_fields(*)')
      .eq('template_id', job.template_id ?? '')
      .order('order_index'),
    db.from('job_field_values').select('*').eq('job_id', jobId),
    db.from('job_signatures').select('*').eq('job_id', jobId),
    db.from('job_photos')
      .select('id, field_id, instance, storage_path, caption, filename, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true }),
  ])

  // Build value maps, keyed per repeatable-section instance (instance 0 = bare id).
  const vals: Record<string, string> = {}
  const arrayVals: Record<string, string[]> = {}
  for (const v of (fieldValues ?? [])) {
    const key = instanceKey(v.field_id, (v as any).instance ?? 0)
    if (v.value_array) arrayVals[key] = v.value_array
    else vals[key] = v.value ?? ''
  }

  const sigs: Record<string, string> = {}
  for (const sig of (signatureData ?? [])) {
    sigs[instanceKey(sig.field_id, (sig as any).instance ?? 0)] = sig.signature_data
  }

  // Photos: count is always known. Only when the template opts in (pdf_include_photos)
  // do we sign URLs and embed them as a captioned grid — otherwise the PDF keeps the
  // legacy "N photos stored internally" note (unchanged for every existing template).
  // The template flag is the gate: when on, every stored photo is embedded. (The
  // per-photo include_in_pdf column has no UI and defaults false, so gating on it
  // would embed nothing — it is intentionally ignored here.)
  const photoRows = (photoData ?? []) as Array<{ field_id: string | null; instance: number | null; storage_path: string; caption: string | null; filename: string | null }>
  const photoCount = photoRows.length
  let photos: Array<{ field_id: string | null; instance: number; url: string; caption: string | null; filename: string | null }> = []
  if (job.template?.pdf_include_photos === true && photoRows.length > 0) {
    const usable = photoRows.filter(p => p.storage_path)
    const paths = usable.map(p => p.storage_path)
    const signed = paths.length
      ? (await db.storage.from('job-photos').createSignedUrls(paths, 3600)).data ?? []
      : []
    const urlByPath = new Map<string, string>()
    for (const s of signed) if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
    const built = usable
      .map(p => ({ field_id: p.field_id, instance: p.instance ?? 0, url: urlByPath.get(p.storage_path) ?? '', storage_path: p.storage_path, caption: p.caption, filename: p.filename }))
      .filter(p => p.url)

    // EXIF-orientation fix: @react-pdf ignores the EXIF orientation flag, so a phone
    // "portrait" photo (landscape pixels + a rotate flag) prints sideways. For any
    // photo whose flag says it needs rotating, bake the orientation into the pixels —
    // sharp.rotate() auto-orients from EXIF and strips the flag, rotating ONLY (it
    // never resizes, so the aspect ratio is unchanged). Upright photos (orientation
    // 1/none) keep their signed URL untouched, so we don't re-encode or inline them.
    // Only the rotated ones are downloaded + processed, keeping memory/time in check.
    photos = await Promise.all(built.map(async (p) => {
      try {
        const head = await fetch(p.url, { headers: { Range: 'bytes=0-131071' } })
        const orientation = head.ok ? await exifr.orientation(Buffer.from(await head.arrayBuffer())).catch(() => undefined) : undefined
        if (orientation && orientation !== 1) {
          const { data: blob } = await db.storage.from('job-photos').download(p.storage_path)
          if (blob) {
            const rotated = await sharp(Buffer.from(await blob.arrayBuffer())).rotate().jpeg({ quality: 92 }).toBuffer()
            return { ...p, url: `data:image/jpeg;base64,${rotated.toString('base64')}` }
          }
        }
      } catch { /* on any failure, fall back to the signed URL as-is */ }
      return p
    }))
  }

  // Assigned surveyors (printed in the report header). job_surveyors has two FKs to
  // profiles (surveyor_id, created_by), so the embed is hinted by the surveyor FK.
  const { data: survRows } = await db.from('job_surveyors')
    .select('surveyor:profiles!job_surveyors_surveyor_id_fkey(full_name), created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
  const surveyors = ((survRows ?? []) as any[]).map(r => r.surveyor?.full_name).filter(Boolean) as string[]

  // Letterhead logo as a data URI (reliable in serverless), loaded from the app origin.
  // Use the same clean letterhead logo the invoice uses. Templates that opt out
  // (pdf_hide_logo) skip it and fall back to the company-name text header.
  let logoSrc: string | undefined
  if (job.template?.pdf_hide_logo !== true) {
    try {
      const res = await fetch(new URL('/logo-invoice.png', new URL(request.url).origin))
      if (res.ok) logoSrc = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
    } catch { /* logo is optional — the report falls back to the company name */ }
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

  // Render PDF. Wrap so a render failure returns a clean JSON 500 (which the client
  // helper turns into a friendly "Could not generate the report") instead of an
  // unhandled crash that the browser might render as a broken page.
  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      React.createElement(JobPDF, {
        job,
        sections: processedSections,
        fieldValues: vals,
        arrayValues: arrayVals,
        signatures: sigs,
        photoCount,
        photos,
        disclaimer: job.template?.pdf_disclaimer ?? null,
        preamble: job.template?.pdf_preamble ?? null,
        logoSrc,
        hideLogo: job.template?.pdf_hide_logo === true,
        surveyors,
        hideClient: job.template?.pdf_hide_client === true,
        hideSurveyor: job.template?.pdf_hide_surveyor === true,
      }) as any
    )
  } catch (e) {
    console.error('[pdf:render]', jobId, e)
    return NextResponse.json({ error: 'Failed to render the report.' }, { status: 500 })
  }

  // Saved report filename, e.g.
  //   "M.V. Guyana Hero - Daily Borescoping Report - 25.06.2026 - TEAL C-L #1065.pdf"
  // Format: "M.V. <vessel> - <report title> - <dd.mm.yyyy> - <job number>", matching
  // what's shown in the app: the title is the report/template name, and the job number
  // is verbatim. Each part is omitted when absent, and the whole thing is sanitised to
  // a valid cross-platform filename (a "/" can't appear in a filename, so it → "-").
  const ddmmyyyy = (iso: string | null | undefined): string => {
    const m = (iso ?? '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
    return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
  }
  // Prefer the date shown on the report itself (the checklist's own date field),
  // then the job's scheduled date, then its creation date.
  let checklistDate = ''
  for (const sec of processedSections) {
    const f = (sec.fields ?? []).find((x: any) => x.field_type === 'date' && vals[instanceKey(x.id, 0)])
    if (f) { checklistDate = vals[instanceKey(f.id, 0)]; break }
  }
  const displayName = [
    job.vessel_name ? `M.V. ${job.vessel_name}` : null,
    job.template?.name ?? job.title ?? null,
    ddmmyyyy(checklistDate || job.scheduled_date || job.created_at) || null,
    job.job_number ?? job.report_number ?? null,
  ].filter(Boolean).join(' - ')
  const filename = `${displayName
    .replace(/[\\/:*?"<>|]+/g, '-')  // characters not allowed in filenames → dash
    .replace(/[^\x20-\x7E]/g, '')    // strip non-ASCII so the header stays valid
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')           // Windows dislikes trailing dots/spaces
    || 'Report'}.pdf`

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
