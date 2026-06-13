import { NextResponse } from 'next/server'
import { assertInvoicingAccess } from '@/lib/jobs/invoice-access'
import { renderInvoicePdf } from '@/lib/pdf/renderInvoice'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const gate = await assertInvoicingAccess()
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const { invoiceId } = await params
  const rendered = await renderInvoicePdf(invoiceId, request.url)
  if (!rendered) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

  return new NextResponse(new Uint8Array(rendered.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${rendered.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
