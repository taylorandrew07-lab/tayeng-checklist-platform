import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { InvoicePDF } from '@/lib/pdf/InvoicePDF'
import React from 'react'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single()
  if (!profile || profile.is_active !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Admins always; office only with the invoicing.view permission.
  let canAccess = profile.role === 'admin'
  if (!canAccess && profile.role === 'office') {
    const { data: perm } = await supabase
      .from('office_user_permissions')
      .select('permission_key')
      .eq('profile_id', user.id).eq('permission_key', 'invoicing.view').eq('allowed', true)
      .maybeSingle()
    canAccess = !!perm
  }
  if (!canAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { invoiceId } = await params
  const db = createServiceClient()

  const { data: invoice } = await db.from('invoices').select('*').eq('id', invoiceId).single()
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  const [{ data: lines }, { data: taxes }, { data: client }, { data: job }] = await Promise.all([
    db.from('invoice_line_items').select('*').eq('invoice_id', invoiceId).order('sort'),
    db.from('invoice_taxes').select('*').eq('invoice_id', invoiceId),
    invoice.client_id ? db.from('clients').select('name, address, contact_phone').eq('id', invoice.client_id).single() : Promise.resolve({ data: null }),
    invoice.job_id ? db.from('jobs').select('report_number').eq('id', invoice.job_id).single() : Promise.resolve({ data: null }),
  ])

  // Load the letterhead logo as a data URI (reliable in serverless — no remote fetch).
  let logoSrc: string | undefined
  try {
    const res = await fetch(new URL('/logo-full.png', request.url))
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer())
      logoSrc = `data:image/png;base64,${buf.toString('base64')}`
    }
  } catch { /* fall back to the text wordmark in the PDF */ }

  const pdfBuffer = await renderToBuffer(
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
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Invoice_${safe}.pdf"`,
      'Cache-Control': 'no-store',
    },
  })
}
