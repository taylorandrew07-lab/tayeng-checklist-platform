'use client'

// Shared invoices list (admin + office read-only). Responsive table → stacked
// cards. Derives an "overdue" badge for sent invoices past their due date.

import Link from 'next/link'
import { formatDate } from '@/lib/utils'
import { money } from '@/lib/jobs/tracker'
import { isOverdue, type InvoiceListRow } from '@/lib/jobs/invoicing'
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

export default function InvoicesTable({ rows, hrefFor }: { rows: InvoiceListRow[]; hrefFor?: (row: InvoiceListRow) => string | null }) {
  if (rows.length === 0) {
    return <div className="card p-10 text-center text-sm text-gray-400">No invoices yet.</div>
  }

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
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const href = hrefFor?.(r) ?? null
              const num = <span className="tnum font-medium text-gray-900">{r.invoice_number ?? '—'}</span>
              return (
                <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60 transition-colors">
                  <td className="px-4 py-3">{href ? <Link href={href} className="hover:text-brand-700">{num}</Link> : num}</td>
                  <td className="px-4 py-3 tnum text-gray-500">{r.report_number ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{r.client_name ?? '—'}</div>
                    {r.vessel_name && <div className="text-xs text-gray-400">M.V. {r.vessel_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-right tnum text-gray-900">{money(r.total, r.currency)}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(r.issue_date)}</td>
                  <td className="px-4 py-3 text-gray-500">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                  <td className="px-4 py-3"><StatusPill row={r} /></td>
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
          const body = (
            <div className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="tnum font-medium text-gray-900">{r.invoice_number ?? '—'}</span>
                <StatusPill row={r} />
              </div>
              <p className="text-sm text-gray-900 mt-1">{r.client_name ?? '—'}</p>
              {r.vessel_name && <p className="text-xs text-gray-400">M.V. {r.vessel_name}</p>}
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-gray-400 text-xs">Due {r.due_date ? formatDate(r.due_date) : '—'}</span>
                <span className="tnum font-semibold text-gray-900">{money(r.total, r.currency)}</span>
              </div>
            </div>
          )
          return href ? <Link key={r.id} href={href} className="block">{body}</Link> : <div key={r.id}>{body}</div>
        })}
      </div>
    </>
  )
}
