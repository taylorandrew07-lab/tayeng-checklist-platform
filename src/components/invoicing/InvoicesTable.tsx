'use client'

// Shared invoices list (admin + office read-only). Responsive table → stacked
// cards. With `manage` (admin), each row gets actions — PDF, email draft, void /
// restore, delete — so consolidated invoices (which have no single job page) are
// managed here. Payment is not tracked (migration 146): no sent/paid/overdue.

import { useState } from 'react'
import Link from 'next/link'
import { FileText, Mail, Ban, RotateCcw, Trash2, Loader2, Pencil } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { money } from '@/lib/jobs/tracker'
import { toast } from '@/components/ui/toast'
import { confirmDialog } from '@/components/ui/confirm'
import { voidInvoice, restoreInvoice, deleteInvoice, type InvoiceListRow } from '@/lib/jobs/invoicing'
import { InvoiceStatusPill } from '@/components/job/StatusPill'

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

function RowActions({ row, onChanged, onEdit }: { row: InvoiceListRow; onChanged: () => void; onEdit?: (row: InvoiceListRow) => void }) {
  const [busy, setBusy] = useState<string | null>(null)

  // Void cancels an invoice without deleting it — it drops out of every billing
  // total but the record (and its number) stays. Deleting is the destructive one.
  async function setVoid(next: boolean) {
    if (next && !(await confirmDialog({
      title: 'Void this invoice?',
      message: 'It stops counting towards billing totals but the record and its number are kept. The job stays closed — delete the invoice instead if you need to re-bill it.',
      confirmLabel: 'Void invoice',
    }))) return
    setBusy(next ? 'void' : 'restore')
    const res = next ? await voidInvoice(row.id) : await restoreInvoice(row.id)
    setBusy(null)
    if (res.error) { toast.error(res.error); return }
    toast.success(next ? 'Invoice voided' : 'Invoice restored'); onChanged()
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
      {onEdit && <button onClick={() => onEdit(row)} title="Edit" className={`${btn} hover:text-brand-600`}><Pencil className="h-3.5 w-3.5" /></button>}
      <a href={`/api/invoice-pdf/${row.id}`} target="_blank" rel="noopener noreferrer" title="PDF" className={`${btn} hover:text-brand-600`}><FileText className="h-3.5 w-3.5" /></a>
      <button onClick={email} disabled={!!busy} title="Email draft" className={`${btn} hover:text-brand-600`}>{busy === 'email' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}</button>
      {row.status === 'active'
        ? <button onClick={() => setVoid(true)} disabled={!!busy} title="Void" className={`${btn} hover:text-amber-700`}>{busy === 'void' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}</button>
        : <button onClick={() => setVoid(false)} disabled={!!busy} title="Restore" className={`${btn} hover:text-cyan-700`}>{busy === 'restore' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}</button>}
      <button onClick={remove} disabled={!!busy} title="Delete" className={`${btn} hover:text-red-600 hover:bg-red-50`}>{busy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
    </div>
  )
}

export default function InvoicesTable({ rows, hrefFor, manage, onChanged, onEdit }: {
  rows: InvoiceListRow[]
  hrefFor?: (row: InvoiceListRow) => string | null
  manage?: boolean
  onChanged?: () => void
  onEdit?: (row: InvoiceListRow) => void
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
                  <td className="px-4 py-3"><InvoiceStatusPill status={r.status} /></td>
                  {manage && <td className="px-4 py-3"><RowActions row={r} onChanged={refresh} onEdit={onEdit} /></td>}
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
              <InvoiceStatusPill status={r.status} />
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
              {manage && <div className="mt-2 pt-2 border-t border-gray-100"><RowActions row={r} onChanged={refresh} onEdit={onEdit} /></div>}
            </div>
          )
        })}
      </div>
    </>
  )
}
