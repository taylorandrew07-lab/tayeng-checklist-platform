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

  const [{ data: lines }, { data: taxes }, { data: client }, { data: job }] = await Promise.all([
    db.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).order('sort'),
    db.from('invoice_taxes').select('*').eq('invoice_id', invoiceId),
    invoice.client_id ? db.from('clients').select('name, address, contact_phone, contact_email').eq('id', invoice.client_id).single() : Promise.resolve({ data: null }),
    invoice.job_id ? db.from('jobs').select('report_number').eq('id', invoice.job_id).single() : Promise.resolve({ data: null }),
  ])

  let logoSrc: string | undefined
  try {
    const res = await fetch(new URL('/logo-invoice.png', origin))
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      logoSrc = `data:image/png;base64,${buf.toString('base64')}`
    }
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
    clientEmail: (client as any)?.contact_email ?? null,
    clientName: (client as any)?.name ?? null,
    jobId: invoice.job_id ?? null,
  }
}
