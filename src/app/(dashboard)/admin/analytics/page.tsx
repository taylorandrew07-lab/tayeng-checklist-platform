'use client'

// Analytics — a company-wide view across every job: volume, pipeline, types,
// trend over time, top clients, billing (per currency) and labour/overtime.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Briefcase, FolderOpen, CalendarDays, Receipt, AlertTriangle, Clock, TrendingUp } from 'lucide-react'
import { WORKFLOW, money } from '@/lib/jobs/tracker'
import { getAnalytics, type Analytics } from '@/lib/jobs/analytics'

function Kpi({ label, value, icon: Icon, tone = 'gray', href }: { label: string; value: number | string; icon: typeof Briefcase; tone?: 'gray' | 'amber' | 'red' | 'brand'; href?: string }) {
  const tones = { gray: 'bg-gray-100 text-gray-500', amber: 'bg-amber-100 text-amber-600', red: 'bg-red-100 text-red-600', brand: 'bg-brand-100 text-brand-600' }
  const inner = (
    <div className="card p-4 h-full transition-[transform,box-shadow] duration-200 group-hover:shadow-md group-hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{label}</p>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tones[tone]}`}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-2 tnum">{value}</p>
    </div>
  )
  return href ? <Link href={href} className="block group">{inner}</Link> : inner
}

function Bars({ rows, color = 'bg-brand-500' }: { rows: { label: React.ReactNode; count: number; color?: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-32 shrink-0 text-sm text-gray-600 truncate">{r.label}</div>
          <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${r.color ?? color}`} style={{ width: `${(r.count / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right text-sm tnum text-gray-700">{r.count}</span>
        </div>
      ))}
    </div>
  )
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null)
  useEffect(() => { getAnalytics().then(setData) }, [])

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-rise">
      <div>
        <h1 className="page-title">Analytics</h1>
        <p className="text-gray-500 mt-1 text-sm">Everything across all jobs — volume, pipeline, billing and labour.</p>
      </div>

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

function MonthlyChart({ rows }: { rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="flex items-end gap-1.5 h-40">
      {rows.map((r, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
          <div className="w-full flex items-end justify-center h-full">
            <div className="w-full max-w-[2.5rem] rounded-t bg-brand-500/90 hover:bg-brand-600 transition-colors relative group" style={{ height: `${Math.max(2, (r.count / max) * 100)}%` }}>
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] tnum text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">{r.count}</span>
            </div>
          </div>
          <span className="text-[10px] text-gray-400 whitespace-nowrap">{r.label}</span>
        </div>
      ))}
    </div>
  )
}
