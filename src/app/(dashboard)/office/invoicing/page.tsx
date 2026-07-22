'use client'

import { useState, useEffect } from 'react'
import { Receipt, Lock, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import { cn } from '@/lib/utils'
import { listInvoices, type InvoiceListRow } from '@/lib/jobs/invoicing'
import InvoicesTable from '@/components/invoicing/InvoicesTable'

type StatusFilter = 'active' | 'void' | 'all'

export default function OfficeInvoicing() {
  const [canView, setCanView] = useState(false)
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<InvoiceListRow[] | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('active')
  const [query, setQuery] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const granted = await fetchMyOfficePermissions(supabase)
      const allowed = granted.has(OFFICE_PERMISSIONS.INVOICING_VIEW) || granted.has(OFFICE_PERMISSIONS.INVOICING_MANAGE)
      setCanView(allowed)
      if (allowed) setRows(await listInvoices())
      setLoading(false)
    }
    load()
  }, [])

  const term = query.trim().toLowerCase()
  const filtered = (rows ?? []).filter(r => {
    if (term && ![r.invoice_number, r.client_name, r.vessel_name, r.report_number]
      .some(v => (v ?? '').toLowerCase().includes(term))) return false
    if (filter === 'all') return true
    return r.status === filter
  })
  const filters: [StatusFilter, string][] = [['active', 'Invoiced'], ['void', 'Void'], ['all', 'All']]

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center"><Receipt className="h-5 w-5 text-brand-600" /></div>
        <div>
          <h1 className="page-title">Finance</h1>
          <p className="text-gray-500 text-sm mt-0.5">Read-only view of client invoices.</p>
        </div>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-gray-400">Loading…</div>
      ) : !canView ? (
        <div className="card p-8 text-center space-y-2">
          <Lock className="h-8 w-8 text-gray-300 mx-auto" />
          <p className="text-sm font-medium text-gray-700">No invoicing access</p>
          <p className="text-sm text-gray-500">An administrator needs to grant you invoicing permission.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="input-base pl-9" placeholder="Search by invoice #, client, vessel or report #…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {filters.map(([k, label]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={cn('px-3 py-1 rounded-full text-xs font-medium transition-colors',
                  filter === k ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}>
                {label}
              </button>
            ))}
          </div>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14 w-full" />)}</div>
          ) : (
            <InvoicesTable rows={filtered} hrefFor={r => r.job_id ? `/office/jobs/${r.job_id}` : null} />
          )}
        </div>
      )}
    </div>
  )
}
