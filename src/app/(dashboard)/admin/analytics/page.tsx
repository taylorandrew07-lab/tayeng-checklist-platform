'use client'

// Analytics — a company-wide view across every job: volume, pipeline, types,
// trend over time, top clients, billing (per currency) and labour/overtime.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, FolderOpen, CalendarDays, Receipt, AlertTriangle, Clock, TrendingUp, BarChart3 } from 'lucide-react'
import { WORKFLOW, money } from '@/lib/jobs/tracker'
import { getAnalytics, type Analytics } from '@/lib/jobs/analytics'
import PageHeader from '@/components/ui/PageHeader'
import { Kpi, Bars, MonthlyChart } from '@/components/insights/widgets'

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null)
  useEffect(() => { getAnalytics().then(setData) }, [])

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <PageHeader icon={BarChart3} title="Insights" subtitle="Everything across all jobs — volume, pipeline, billing and labour." />

      {!data ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-24" />)}</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi label="Total jobs" value={data.kpis.totalJobs} icon={Briefcase} href="/admin/jobs" />
            <Kpi label="Open" value={data.kpis.openJobs} icon={FolderOpen} tone="brand" href="/admin/jobs" />
            <Kpi label="This month" value={data.kpis.thisMonth} icon={CalendarDays} />
            <Kpi label="Awaiting invoice" value={data.kpis.awaitingInvoice} icon={Receipt} tone="amber" href="/admin/invoicing" />
            <Kpi label="Overdue" value={data.kpis.overdueCount} icon={AlertTriangle} tone={data.kpis.overdueCount > 0 ? 'red' : 'gray'} href="/admin/invoicing" />
            <Kpi label="Overtime jobs" value={data.kpis.otJobs} icon={Clock} tone="amber" />
          </div>

          {/* Pipeline + types */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className="card p-5">
              <h2 className="section-title mb-4 flex items-center gap-2"><Briefcase className="h-4 w-4 text-gray-400" /> Pipeline</h2>
              <Bars rows={data.byStatus.filter(s => s.count > 0).map(s => ({ label: <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${WORKFLOW[s.status].dot}`} />{WORKFLOW[s.status].label}</span>, count: s.count, color: WORKFLOW[s.status].dot }))} />
              {data.byStatus.every(s => s.count === 0) && <p className="text-sm text-gray-400">No jobs yet.</p>}
            </section>
            <section className="card p-5">
              <h2 className="section-title mb-4">Jobs by type</h2>
              {data.byType.length === 0 ? <p className="text-sm text-gray-400">No jobs yet.</p>
                : <Bars rows={data.byType.map(t => ({ label: t.type, count: t.count }))} />}
            </section>
          </div>

          {/* Trend over time */}
          <section className="card p-5">
            <h2 className="section-title mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-gray-400" /> Jobs over time <span className="text-xs font-normal text-gray-400">· last 12 months</span></h2>
            <MonthlyChart rows={data.byMonth} />
          </section>

          {/* Billing per currency */}
          {data.billing.length > 0 && (
            <section>
              <h2 className="section-title mb-3">Billing</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.billing.map(b => (
                  <div key={b.currency} className="card p-5">
                    <div className="flex items-center justify-between mb-3"><span className="text-xs font-semibold tracking-wide text-gray-400">{b.currency}</span></div>
                    <p className="text-2xl font-semibold text-gray-900 tnum">{money(b.outstanding, b.currency)}</p>
                    <p className="text-xs text-gray-400 mb-3">outstanding</p>
                    <div className="space-y-1 text-sm border-t border-gray-100 pt-3">
                      {b.overdue > 0 && <div className="flex justify-between"><span className="text-red-600">Overdue</span><span className="tnum text-red-600 font-medium">{money(b.overdue, b.currency)}</span></div>}
                      <div className="flex justify-between text-gray-500"><span>Paid</span><span className="tnum">{money(b.paid, b.currency)}</span></div>
                      <div className="flex justify-between text-gray-400"><span>Invoiced</span><span className="tnum">{money(b.invoiced, b.currency)}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Top clients */}
          {data.topClients.length > 0 && (
            <section>
              <h2 className="section-title mb-3">Top clients</h2>
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                    <th className="font-medium px-4 py-2.5">Client</th>
                    <th className="font-medium px-4 py-2.5 text-right">Jobs</th>
                    <th className="font-medium px-4 py-2.5 text-right">Invoiced</th>
                  </tr></thead>
                  <tbody>
                    {data.topClients.slice(0, 10).map(c => (
                      <tr key={c.client_id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3"><Link href={`/admin/clients?focus=${c.client_id}`} className="text-brand-700 hover:underline">{c.name}</Link></td>
                        <td className="px-4 py-3 text-right tnum text-gray-700">{c.jobs}</td>
                        <td className="px-4 py-3 text-right">
                          {c.revenue.length === 0 ? <span className="text-gray-300">—</span>
                            : <div className="flex flex-col items-end gap-0.5">{c.revenue.map(r => <span key={r.currency} className="tnum text-gray-700">{money(r.amount, r.currency)}</span>)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Labour & overtime */}
          <section>
            <h2 className="section-title mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-gray-400" /> Labour &amp; overtime <span className="text-xs font-normal text-gray-400">· {data.overtimeHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} OT hrs total</span></h2>
            {data.labour.length === 0 ? (
              <div className="card p-8 text-center text-sm text-gray-400">No hours logged yet.</div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100 text-left text-xs text-gray-400">
                    <th className="font-medium px-4 py-2.5">Surveyor</th>
                    <th className="font-medium px-4 py-2.5 text-right">Jobs</th>
                    <th className="font-medium px-4 py-2.5 text-right">Regular hrs</th>
                    <th className="font-medium px-4 py-2.5 text-right">Overtime hrs</th>
                    <th className="font-medium px-4 py-2.5 text-right">Pay</th>
                  </tr></thead>
                  <tbody>
                    {data.labour.map(s => (
                      <tr key={s.surveyor_id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3 text-gray-900">{s.name}</td>
                        <td className="px-4 py-3 text-right tnum text-gray-600">{s.jobs}</td>
                        <td className="px-4 py-3 text-right tnum text-gray-600">{s.regular_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td className="px-4 py-3 text-right tnum font-medium text-gray-900">{s.overtime_hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                        <td className="px-4 py-3 text-right">
                          {s.pay.length === 0 ? <span className="text-gray-300">—</span>
                            : <div className="flex flex-col items-end gap-0.5">{s.pay.map(p => <span key={p.currency} className="tnum text-gray-700">{money(p.amount, p.currency)}</span>)}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
