'use client'

// Shared invoices list (admin + office read-only). Responsive table → stacked
// cards. Derives an "overdue" badge for sent invoices past their due date.
// With `manage` (admin), each row gets actions — PDF, email draft, advance status,
// delete — so consolidated invoices (which have no single job page) are managed here.

import { useState } from 'react'
import Link from 'next/link'
import { FileText, Mail, Send, CheckCircle2, Trash2, Loader2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { money } from '@/lib/jobs/tracker'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { isOverdue, setInvoiceAndJobsStatus, deleteInvoice, type InvoiceListRow } from '@/lib/jobs/invoicing'
import type { Invoice } from '@/lib/types/database'

const STATUS_PILL: Record<Invoice['status'], string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-cyan-100 text-cyan-700',
  paid: 'bg-green-100 text-green-700', overdue: 'bg-red-100 text-red-700', void: 'bg-slate-200 text-slate-500',
}

function StatusPill({ row }: { row: InvoiceListRow }) {
  const overdue = isOverdue(row)
  const s = overdue ? 'overdue' : row.status
  const label = overdue ? 'Overdue' : row.status[0].toUpperCase() + row.status.slice(1)
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL[s]}`}>{label}</span>
}

/** Secondary line under the client name: the vessel(s) this invoice covers, plus
 *  the bill-to party when it differs from the work client. */
function SubLine({ row }: { row: InvoiceListRow }) {
  const vessels = row.vessel_name ? `M.V. ${row.vessel_name}` : row.job_id ? null : (row.line_count ? `${row.line_count} vessel${row.line_count === 1 ? '' : 's'}` : 'Consolidated')
  return (
    <>
      {vessels && <div className="text-xs text-gray-400">{vessels}</div>}
      {row.bill_to_name && <div className="text-xs text-brand-600">Bill to: {row.bill_to_name}</div>}
    </>
  )
}

function RowActions({ row, onChanged }: { row: InvoiceListRow; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  async function advance(next: 'sent' | 'paid') {
    if (next === 'paid' && !(await confirmDialog({ title: 'Mark invoice paid?', message: 'This records the invoice as fully paid.', confirmLabel: 'Mark paid' }))) return
    setBusy(next)
    const res = await setInvoiceAndJobsStatus(row.id, next)
    setBusy(null)
    if (res.error) { toast.error(res.error); return }
    toast.success(next === 'sent' ? 'Invoice marked sent' : 'Invoice marked paid'); onChanged()
  }

  async function email() {
    setBusy('email')
    try {
      const res = await fetch(`/api/invoice-email/${row.id}`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error || 'Could not create the draft'); return }
      toast.success(json.noRecipient
        ? `Draft created in ${json.mailbox} — no recipient email on file, add one in Outlook`
        : `Draft created in ${json.mailbox} for ${json.sentTo}`)
      if (json.webLink) window.open(json.webLink, '_blank', 'noopener,noreferrer')
    } catch { toast.error('Could not reach the email service') } finally { setBusy(null) }
  }

  async function remove() {
    if (!(await confirmDialog({ title: 'Delete invoice?', message: 'This permanently removes the invoice and frees its jobs to be invoiced again. This cannot be undone.', confirmLabel: 'Delete invoice', danger: true }))) return
    setBusy('delete')
    const res = await deleteInvoice(row.id)
    setBusy(null)
    if (res.error) { toast.error(res.error); return }
    toast.success('Invoice deleted'); onChanged()
  }

  const btn = 'btn-ghost py-1 px-1.5 text-gray-400'
  return (
    <div className="flex items-center justify-end gap-0.5">
      <a href={`/api/invoice-pdf/${row.id}`} target="_blank" rel="noopener noreferrer" title="PDF" className={`${btn} hover:text-brand-600`}><FileText className="h-3.5 w-3.5" /></a>
      <button onClick={email} disabled={!!busy} title="Email draft" className={`${btn} hover:text-brand-600`}>{busy === 'email' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}</button>
      {row.status === 'draft' && <button onClick={() => advance('sent')} disabled={!!busy} title="Mark sent" className={`${btn} hover:text-cyan-700`}>{busy === 'sent' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}</button>}
      {(row.status === 'sent') && <button onClick={() => advance('paid')} disabled={!!busy} title="Mark paid" className={`${btn} hover:text-green-700`}>{busy === 'paid' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}</button>}
      <button onClick={remove} disabled={!!busy} title="Delete" className={`${btn} hover:text-red-600 hover:bg-red-50`}>{busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
    </div>
  )
}

export default function InvoicesTable({ rows, hrefFor, manage, onChanged }: {
  rows: InvoiceListRow[]
  hrefFor?: (row: InvoiceListRow) => string | null
  manage?: boolean
  onChanged?: () => void
}) {
  if (rows.length === 0) {
    return <div className="card p-10 text-center text-sm text-gray-400">No invoices yet.</div>
  }
  const refresh = onChanged ?? (() => {})

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
              <th className="font-medium px-4 py-2.5">Invoice #</th>
              <th className="font-medium px-4 py-2.5">Report #</th>
              <th className="font-medium px-4 py-2.5">Client / Vessel</th>
              <th className="font-medium px-4 py-2.5 text-right">Total</th>
              <th className="font-medium px-4 py-2.5">Issued</th>
              <th className="font-medium px-4 py-2.5">Due</th>
              <th className="font-medium px-4 py-2.5">Status</th>
              {manage && <th className="font-medium px-4 py-2.5 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              // Link the number to the job when there is one, else straight to the PDF.
              const href = hrefFor?.(r) ?? null
              const numInner = <span className="tnum font-medium text-gray-900">{r.invoice_number ?? '—'}</span>
              const num = href
                ? <Link href={href} className="hover:text-brand-700">{numInner}</Link>
                : <a href={`/api/invoice-pdf/${r.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-brand-700">{numInner}</a>
              return (
                <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3">{num}</td>
                  <td className="px-4 py-3 tnum text-gray-500">{r.report_number ?? (r.job_id ? '—' : 'multiple')}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{r.client_name ?? '—'}</div>
                    <SubLine row={r} />
                  </td>
                  <td className="px-4 py-3 text-right tnum text-gray-900">{money(r.total, r.currency)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.issue_date)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                  <td className="px-4 py-3"><StatusPill row={r} /></td>
                  {manage && <td className="px-4 py-3"><RowActions row={r} onChanged={refresh} /></td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {rows.map(r => {
          const href = hrefFor?.(r) ?? null
          const header = (
            <div className="flex items-center justify-between gap-2">
              <span className="tnum font-medium text-gray-900">{r.invoice_number ?? '—'}</span>
              <StatusPill row={r} />
            </div>
          )
          return (
            <div key={r.id} className="card p-4">
              {href ? <Link href={href} className="block">{header}</Link> : header}
              <p className="text-sm text-gray-900 mt-1">{r.client_name ?? '—'}</p>
              <SubLine row={r} />
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-gray-400 text-xs">Due {r.due_date ? formatDate(r.due_date) : '—'}</span>
                <span className="tnum font-semibold text-gray-900">{money(r.total, r.currency)}</span>
              </div>
              {manage && <div className="mt-2 pt-2 border-t border-gray-100"><RowActions row={r} onChanged={refresh} /></div>}
            </div>
          )
        })}
      </div>
    </>
  )
}
