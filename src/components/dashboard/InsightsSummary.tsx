'use client'

// Compact insights block embedded on the admin Dashboard: the headline
// operational + billing KPIs, a 12-month job trend, and outstanding billing per
// currency. The full breakdown (types, top clients, labour) stays on /admin/analytics.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FolderOpen, CalendarDays, Receipt, AlertTriangle, TrendingUp } from 'lucide-react'
import { getAnalytics, type Analytics } from '@/lib/jobs/analytics'
import { money } from '@/lib/jobs/tracker'
import { Kpi, MonthlyChart } from '@/components/insights/widgets'

export default function InsightsSummary() {
  const [data, setData] = useState<Analytics | null>(null)
  useEffect(() => { getAnalytics().then(setData) }, [])

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="section-title">Insights</h2>
        <Link href="/admin/analytics" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
      </div>

      {!data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-24" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="Open jobs" value={data.kpis.openJobs} icon={FolderOpen} tone="brand" href="/admin/jobs" />
            <Kpi label="This month" value={data.kpis.thisMonth} icon={CalendarDays} href="/admin/jobs" />
            <Kpi label="Awaiting invoice" value={data.kpis.awaitingInvoice} icon={Receipt} tone="amber" href="/admin/invoicing" />
            <Kpi label="Overdue" value={data.kpis.overdueCount} icon={AlertTriangle} tone={data.kpis.overdueCount > 0 ? 'red' : 'gray'} href="/admin/invoicing" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card p-5">
              <h3 className="section-title mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-gray-400" /> Jobs over time <span className="text-xs font-normal text-gray-400">· last 12 months</span></h3>
              <MonthlyChart rows={data.byMonth} />
            </div>
            <div className="card p-5">
              <h3 className="section-title mb-4">Billing outstanding</h3>
              {data.billing.length === 0 ? (
                <p className="text-sm text-gray-400">No invoices yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.billing.map(b => (
                    <div key={b.currency} className="flex items-baseline justify-between gap-3 border-b border-gray-50 last:border-0 pb-3 last:pb-0">
                      <span className="text-xs font-semibold tracking-wide text-gray-400">{b.currency}</span>
                      <div className="text-right">
                        <p className="text-lg font-semibold text-gray-900 tnum leading-tight">{money(b.outstanding, b.currency)}</p>
                        {b.overdue > 0 && <p className="text-xs text-red-600 tnum">{money(b.overdue, b.currency)} overdue</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
