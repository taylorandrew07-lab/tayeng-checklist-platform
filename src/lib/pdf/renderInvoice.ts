// Server-side invoice PDF render, shared by the download route and the email
// draft route. Uses the service client (callers authorize first).

import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { InvoicePDF } from '@/lib/pdf/InvoicePDF'

export interface RenderedInvoice {
  buffer: Buffer
  filename: string
  invoiceNumber: string | null
  clientEmail: string | null
  clientName: string | null
  jobId: string | null
}

/** Build the invoice PDF. `origin` is used to load the letterhead logo as a data URI. */
export async function renderInvoicePdf(invoiceId: string, origin: string): Promise<RenderedInvoice | null> {
  const db = createServiceClient()

  const { data: invoice } = await db.from('invoices').select('*').eq('id', invoiceId).single()
  if (!invoice) return null

  // Address the invoice to the payer (bill-to) when one is set — e.g. ASCO pays for
  // BP's vessels — otherwise to the work client. This drives the PDF "To:" block and
  // the email recipient.
  const recipientClientId = invoice.bill_to_client_id ?? invoice.client_id

  // Contact/payment info lives in the private client_billing table now; name stays
  // on clients. The service client bypasses RLS, so both are readable here.
  const [{ data: lines }, { data: taxes }, { data: clientRow }, { data: billing }, { data: job }] = await Promise.all([
    db.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).order('sort'),
    db.from('invoice_taxes').select('*').eq('invoice_id', invoiceId),
    recipientClientId ? db.from('clients').select('name').eq('id', recipientClientId).single() : Promise.resolve({ data: null }),
    recipientClientId ? db.from('client_billing').select('address, contact_phone, contact_email, ap_email').eq('client_id', recipientClientId).maybeSingle() : Promise.resolve({ data: null }),
    invoice.job_id ? db.from('jobs').select('report_number').eq('id', invoice.job_id).single() : Promise.resolve({ data: null }),
  ])

  // The PDF "To:" block needs name + address + phone; the email goes to the
  // accounts-payable address when set, else the general contact email.
  const client = recipientClientId ? {
    name: (clientRow as any)?.name ?? null,
    address: (billing as any)?.address ?? null,
    contact_phone: (billing as any)?.contact_phone ?? null,
  } : null
  const recipientEmail = (billing as any)?.ap_email ?? (billing as any)?.contact_email ?? null

  // Letterhead logo (black-text version) as a data URI — reliable in serverless.
  let logoSrc: string | undefined
  try {
    const res = await fetch(new URL('/logo-invoice.png', origin))
    if (res.ok) logoSrc = `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch { /* fall back to the text wordmark */ }

  const buffer = await renderToBuffer(
    React.createElement(InvoicePDF, {
      invoice,
      lines: lines ?? [],
      taxes: taxes ?? [],
      client: (client as any) ?? null,
      reportNumber: (job as any)?.report_number ?? null,
      logoSrc,
    }) as any
  )

  const safe = (invoice.invoice_number ?? 'invoice').replace(/[^a-z0-9]/gi, '_')
  return {
    buffer: buffer as Buffer,
    filename: `Invoice_${safe}.pdf`,
    invoiceNumber: invoice.invoice_number ?? null,
    clientEmail: recipientEmail,
    clientName: client?.name ?? null,
    jobId: invoice.job_id ?? null,
  }
}
