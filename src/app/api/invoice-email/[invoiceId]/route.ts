import { NextResponse } from 'next/server'
import { assertInvoicingAccess } from '@/lib/jobs/invoice-access'
import { renderInvoicePdf } from '@/lib/pdf/renderInvoice'
import { getGraphConfig, createMailDraft } from '@/lib/email/graph'
import { createServiceClient } from '@/lib/supabase/server'
import { COMPANY } from '@/lib/company'

// Create a DRAFT email in the office mailbox with the invoice PDF attached.
// Admin-only — sending stays a human step in Outlook.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const gate = await assertInvoicingAccess({ adminOnly: true })
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const cfg = getGraphConfig()
  if (!cfg) return NextResponse.json({ error: 'Email is not configured. Set the MS_* environment variables.' }, { status: 503 })

  const { invoiceId } = await params
  const rendered = await renderInvoicePdf(invoiceId, request.url)
  if (!rendered) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const num = rendered.invoiceNumber ?? ''
  const subject = `${COMPANY.name} — Tax Invoice ${num}`.trim()
  const greeting = rendered.clientName ? `Dear ${rendered.clientName},` : 'Dear Sir/Madam,'
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.5">
      <p>${greeting}</p>
      <p>Please find attached our tax invoice${num ? ` <strong>${num}</strong>` : ''} for your kind attention.</p>
      <p>Payment is due on presentation of invoice. Should you have any queries, please do not hesitate to contact us.</p>
      <p>Kind regards,<br/>${COMPANY.name}<br/>${COMPANY.email} &nbsp;|&nbsp; ${COMPANY.phone}</p>
    </div>`.trim()

  let draft
  try {
    draft = await createMailDraft(cfg, {
      to: rendered.clientEmail ? [rendered.clientEmail] : [],
      subject,
      html,
      attachment: { name: rendered.filename, contentBytesBase64: rendered.buffer.toString('base64') },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create the email draft' }, { status: 502 })
  }

  // Audit trail.
  if (rendered.jobId) {
    const db = createServiceClient()
    await db.from('activity_log').insert({
      entity: 'job', entity_id: rendered.jobId, action: 'invoice:email_draft',
      actor_id: gate.userId, meta: { invoice_number: num, to: rendered.clientEmail ?? null },
    })
  }

  return NextResponse.json({
    ok: true,
    webLink: draft.webLink,
    mailbox: cfg.mailbox,
    sentTo: rendered.clientEmail,
    noRecipient: !rendered.clientEmail,
  })
}
