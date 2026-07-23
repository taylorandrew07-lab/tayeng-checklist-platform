'use client'

import { useState, useEffect } from 'react'
import { Receipt, Lock, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import { listInvoices, type InvoiceListRow } from '@/lib/jobs/invoicing'
import InvoicesTable from '@/components/invoicing/InvoicesTable'
import PageHeader from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import EmptyState from '@/components/ui/EmptyState'

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
      <PageHeader icon={Receipt} title="Finance" subtitle="Read-only view of client invoices." />

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14 w-full" />)}</div>
      ) : !canView ? (
        <EmptyState
          icon={Lock}
          title="No invoicing access"
          description="An administrator needs to grant you invoicing permission."
        />
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className="input-base pl-9" placeholder="Search by invoice #, client, vessel or report #…" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            size="sm"
            ariaLabel="Filter invoices by status"
            options={filters.map(([value, label]) => ({ value, label }))}
          />
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
