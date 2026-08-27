import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { JobPDF } from '@/lib/pdf/JobPDF'
import { BorescopingReportPDF, BORESCOPING_TEMPLATE_ID } from '@/lib/pdf/BorescopingReportPDF'
import React from 'react'
import sharp from 'sharp'
import exifr from 'exifr'
import { checkConditionalLogic, withVesselPrefix } from '@/lib/utils'
import { instanceKey } from '@/lib/offline/instanceKeys'
import { mergeAttachments, ATTACHMENT_REASONS, type AttachmentPlan } from '@/lib/pdf/mergeAttachments'
import { loadAttachments, withDeadline } from '@/lib/pdf/fetchAttachments'

// Reports with many full-resolution photos take a while to render — give the function
// headroom so it completes instead of being cut off (which the client sees as a hang).
export const maxDuration = 60

// --- Attachment fetching budget (migration 202) ------------------------------------
// The report itself is the deliverable; the appended documents are a bonus. Neither
// number may be raised to the point where a Storage problem can cost Andrew a report
// that has already rendered: maxDuration is 60s and fetchJobPdfFile aborts the client
// at 70s, so anything the fetch does not finish inside its own budget must degrade to a
// separator page rather than keep the response waiting.
const ATTACHMENT_BUDGET_MS = 20_000   // wall clock for signing + ALL downloads
const ATTACHMENT_FETCH_MS = 10_000    // per file

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
      template:checklist_templates(name, pdf_include_photos, pdf_photos_inline, pdf_deficiency_summary, pdf_hide_logo, pdf_hide_client, pdf_hide_surveyor, pdf_balanced_header, pdf_uniform_label_width, pdf_embed_attachments, pdf_show_report_number, pdf_hide_empty_repeatables, pdf_no_hyphenation, pdf_tight_page_bottom, pdf_remark_below, pdf_sort_choices, pdf_format_dates, pdf_sort_by_item_number, pdf_finding_detail, pdf_disclaimer, pdf_preamble),
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
  const allRows = (photoData ?? []) as Array<{ field_id: string | null; instance: number | null; storage_path: string; caption: string | null; filename: string | null }>

  // An attachment field takes documents as well as photographs — a crew list or a
  // ship's-particulars sheet is usually handed over as a PDF. Only real images can be
  // embedded: handing a PDF's URL to <Image> fails the whole render, so documents are
  // split out here and printed as a named attachment line instead.
  const isImageFile = (name: string | null, path: string) =>
    /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i.test(name || path)
  const photoRows = allRows.filter(p => isImageFile(p.filename, p.storage_path))
  const documentRows = allRows.filter(p => !isImageFile(p.filename, p.storage_path))
  // UNCHANGED shape and UNCHANGED created_at order — this is what every other template
  // renders from, and it must stay exactly as it is.
  let documents: Array<{ field_id: string | null; instance: number; filename: string; number?: number }> =
    documentRows.map(p => ({ field_id: p.field_id, instance: p.instance ?? 0, filename: p.filename || 'attachment' }))

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

  // Attached DOCUMENTS, appended to the back of the report in full when the template opts
  // in (checklist_templates.pdf_embed_attachments, migration 202). Off ⇒ none of this
  // runs, `documents` keeps the exact shape and order every other template renders from,
  // and the bytes renderToBuffer produced are returned untouched.
  const embedAttachments = job.template?.pdf_embed_attachments === true
  let attachmentPlan: AttachmentPlan[] = []
  let attachmentsPromise: Promise<AttachmentPlan[]> | null = null
  // One wall clock for signing + every download, started BEFORE renderToBuffer so the
  // fetching cannot outlive the render it was meant to overlap with.
  const attachmentDeadline = Date.now() + ATTACHMENT_BUDGET_MS
  if (embedAttachments && documentRows.length > 0) {
    // Numbered in CHECKLIST order, not upload order, so "Attachment 1" is the first one a
    // reader meets in the body. Built from the RAW `sections` list, not processedSections,
    // so a conditionally-hidden field's attachment is still numbered and still appears.
    const fieldMeta = new Map<string, { item: string | null; label: string; sort: number }>()
    for (const sec of ((sections ?? []) as any[])) {
      ;[...(sec.fields ?? [])]
        .sort((a: any, b: any) => a.order_index - b.order_index)
        .forEach((f: any, fi: number) => fieldMeta.set(f.id, {
          item: f.item_number ?? null,
          label: f.label ?? '',
          sort: (sec.order_index ?? 0) * 1000 + fi,
        }))
    }
    const sortKey = (id: string | null) => fieldMeta.get(id ?? '')?.sort ?? Number.MAX_SAFE_INTEGER
    const ordered = [...documentRows].sort((a, b) =>
      sortKey(a.field_id) - sortKey(b.field_id) || (a.instance ?? 0) - (b.instance ?? 0))

    attachmentPlan = ordered.map((p, i) => {
      const m = fieldMeta.get(p.field_id ?? '')
      return {
        number: i + 1,
        filename: p.filename || 'attachment',
        itemNumber: m?.item ?? null,
        // "Ship's particulars — attach" → "Ship's particulars"
        title: (m?.label ?? 'Attachment').replace(/\s*[—–-]\s*attach(ed)?\s*$/i, '').trim() || 'Attachment',
        storagePath: p.storage_path,
        bytes: null,
        reason: null,
      }
    })

    // The in-body line must quote the SAME number the separator page uses, so both come
    // from this one sorted array.
    const numberByRow = new Map(ordered.map((p, i) => [`${p.field_id}|${p.instance ?? 0}|${p.filename}`, i + 1]))
    documents = documents.map(d => ({ ...d, number: numberByRow.get(`${d.field_id}|${d.instance}|${d.filename}`) }))

    // Fetch the documents NOW so the network overlaps renderToBuffer below. The rules
    // that keep a Storage problem from costing Andrew a report he already has — one at a
    // time, under a wall clock, with the size caps checked before the bytes land — and
    // the reasons each exists are in lib/pdf/fetchAttachments.ts. It never throws and it
    // always settles: every entry comes back with bytes or with a printable reason.
    attachmentsPromise = loadAttachments(attachmentPlan, {
      signUrls: (paths) =>
        db.storage.from('job-photos').createSignedUrls(paths, 900).then(r => r.data ?? []),
      deadline: attachmentDeadline,
      perFetchMs: ATTACHMENT_FETCH_MS,
    })
  }

  // Render PDF. Wrap so a render failure returns a clean JSON 500 (which the client
  // helper turns into a friendly "Could not generate the report") instead of an
  // unhandled crash that the browser might render as a broken page.
  // Standalone reports: signature templates that render through their OWN dedicated
  // component (isolated from the generic renderer so cross-template edits can't touch
  // them). Selected by template id — everything else uses the generic JobPDF.
  const PdfComponent = job.template_id === BORESCOPING_TEMPLATE_ID ? BorescopingReportPDF : JobPDF

  let pdfBuffer: Buffer
  try {
    pdfBuffer = await renderToBuffer(
      React.createElement(PdfComponent, {
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
        balancedHeader: job.template?.pdf_balanced_header === true,
        photosInline: job.template?.pdf_photos_inline === true,
        deficiencySummary: job.template?.pdf_deficiency_summary === true,
        documents,
        // Migration 202 — Pre-Hire report presentation. `=== true` matches every existing
        // flag: it coerces both `undefined` (column not selected, or NO template row at
        // all — 75 jobs carry none) and `null` to false.
        uniformLabelWidth: job.template?.pdf_uniform_label_width === true,
        showReportNumber: job.template?.pdf_show_report_number === true,
        hideEmptyRepeatables: job.template?.pdf_hide_empty_repeatables === true,
        noHyphenation: job.template?.pdf_no_hyphenation === true,
        tightPageBottom: job.template?.pdf_tight_page_bottom === true,
        remarkBelow: job.template?.pdf_remark_below === true,
        sortChoices: job.template?.pdf_sort_choices === true,
        formatDates: job.template?.pdf_format_dates === true,
        sortByItemNumber: job.template?.pdf_sort_by_item_number === true,
        findingDetail: job.template?.pdf_finding_detail === true,
      }) as any
    )
  } catch (e) {
    console.error('[pdf:render]', jobId, e)
    return NextResponse.json({ error: 'Failed to render the report.' }, { status: 500 })
  }

  // Append the attached documents in full (migration 202). mergeAttachments NEVER throws:
  // a bad attachment becomes a separator page that says why, and a failure of the merge
  // itself returns the report unchanged. The report always delivers.
  if (embedAttachments && attachmentsPromise) {
    // Belt AND braces. The loop above respects the deadline itself, but this await is
    // the one place where an unforeseen non-settlement anywhere in that pipeline could
    // hold a FINISHED report until Vercel kills the function — which is the difference
    // between a report with a "could not be retrieved" separator page and no report at
    // all. renderToBuffer has already run, so what is left of the budget is usually
    // nothing: the downloads were overlapped with it and are long since done.
    // The grace is the loop's own worst case: it re-checks the clock before each file,
    // so it can start one last fetch with 1ms left and that fetch runs to its own
    // ATTACHMENT_FETCH_MS signal. Racing any tighter would throw away attachments that
    // had already downloaded successfully. Worst case here is therefore 30s, against
    // maxDuration = 60 and the client's 70s abort — and it only elapses if something
    // never settles, because an already-settled promise wins this race outright.
    const loaded = await withDeadline(
      attachmentsPromise,
      attachmentDeadline + ATTACHMENT_FETCH_MS - Date.now(),
      attachmentPlan.map(a => ({ ...a, reason: ATTACHMENT_REASONS.unretrievable })),
    )
    pdfBuffer = Buffer.from(
      await mergeAttachments(
        new Uint8Array(pdfBuffer),
        loaded,
        (job.template?.pdf_show_report_number === true ? job.report_number : null) ?? job.job_number ?? 'Draft',
        jobId,
      )
    )
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
    job.vessel_name ? withVesselPrefix(job.vessel_name, job.vessel_type) : null,
    job.template?.name ?? job.title ?? null,
    ddmmyyyy(checklistDate || job.scheduled_date || job.created_at) || null,
    // pdf_show_report_number (migration 202): the client-facing 26-08-NNN, not the
    // internal "TEAL C/L #" ledger reference. Flag off ⇒ the historic precedence.
    (job.template?.pdf_show_report_number === true
      ? (job.report_number ?? job.job_number)
      : (job.job_number ?? job.report_number)) ?? null,
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
