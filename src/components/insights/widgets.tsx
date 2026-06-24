'use client'

// Shared insight widgets — used by the full Insights page and the compact
// Insights summary embedded on the admin Dashboard, so both stay in lockstep.

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'

export function Kpi({ label, value, icon: Icon, tone = 'gray', href }: { label: string; value: number | string; icon: LucideIcon; tone?: 'gray' | 'amber' | 'red' | 'brand'; href?: string }) {
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

export function Bars({ rows, color = 'bg-brand-500' }: { rows: { label: React.ReactNode; count: number; color?: string }[]; color?: string }) {
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

export function MonthlyChart({ rows }: { rows: { label: string; count: number }[] }) {
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
