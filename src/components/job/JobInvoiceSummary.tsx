'use client'

// Read-only invoice summary on the job page. Billing itself now lives entirely on
// the Finance page; the job only shows WHICH invoice it was billed on — number,
// status and sent date — so each vessel is traceable to its invoice.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Receipt, FileText, ExternalLink } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { money } from '@/lib/jobs/tracker'
import { formatDate } from '@/lib/utils'
import { InvoiceStatusPill } from '@/components/job/StatusPill'
import type { Invoice, Job } from '@/lib/types/database'

export default function JobInvoiceSummary({ job }: { job: Job }) {
  const [inv, setInv] = useState<Invoice | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const supabase = createClient()
      let data: Invoice | null = null
      // The consolidated stamp (jobs.invoice_id) is the primary link; fall back to a
      // legacy per-job invoice (invoices.job_id) for older data.
      if (job.invoice_id) {
        const r = await supabase.from('invoices').select('*').eq('id', job.invoice_id).maybeSingle()
        data = (r.data as Invoice) ?? null
      }
      if (!data) {
        const r = await supabase.from('invoices').select('*').eq('job_id', job.id).maybeSingle()
        data = (r.data as Invoice) ?? null
      }
      setInv(data)
      setLoading(false)
    })()
  }, [job.invoice_id, job.id])

  if (loading) return <div className="card p-5"><div className="skeleton h-5 w-32 mb-3" /><div className="skeleton h-16 w-full" /></div>

  if (!inv) return (
    <div className="card p-8 text-center space-y-2 max-w-md mx-auto">
      <div className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto"><Receipt className="h-5 w-5 text-gray-400" /></div>
      <p className="text-sm font-medium text-gray-700">Not invoiced yet</p>
      <p className="text-sm text-gray-500">Invoices are created on the Finance page — pick the client, tick this vessel (and any others), and bill them on one invoice.</p>
      <Link href="/admin/invoicing" className="btn-secondary py-1.5 px-3 text-sm inline-flex mt-1"><Receipt className="h-4 w-4" /> Finance → Create invoice</Link>
    </div>
  )

  return (
    <div className="card p-5 space-y-3 max-w-md">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900 flex items-center gap-2"><Receipt className="h-4 w-4 text-brand-500" /> Invoice</h3>
        <InvoiceStatusPill status={inv.status} />
      </div>
      <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-sm">
        <div><p className="text-[11px] text-gray-400">Invoice no.</p><p className="tnum font-medium text-gray-900">{inv.invoice_number ?? '—'}</p></div>
        <div><p className="text-[11px] text-gray-400">Total</p><p className="tnum text-gray-900">{money(Number(inv.total), inv.currency)}</p></div>
        <div><p className="text-[11px] text-gray-400">Issued</p><p className="text-gray-700">{formatDate(inv.issue_date)}</p></div>
        <div><p className="text-[11px] text-gray-400">Sent</p><p className="text-gray-700">{inv.sent_at ? formatDate(inv.sent_at) : '—'}</p></div>
      </div>
      <div className="flex items-center gap-2 pt-1 border-t border-gray-100">
        <a href={`/api/invoice-pdf/${inv.id}`} target="_blank" rel="noopener noreferrer" className="btn-secondary py-1.5 px-3 text-sm mt-3"><FileText className="h-4 w-4" /> PDF</a>
        <Link href="/admin/invoicing" className="btn-ghost py-1.5 px-3 text-sm text-brand-600 mt-3"><ExternalLink className="h-4 w-4" /> Manage in Finance</Link>
      </div>
    </div>
  )
}
