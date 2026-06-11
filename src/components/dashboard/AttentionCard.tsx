'use client'

import Link from 'next/link'
import { AlertTriangle, ChevronRight } from 'lucide-react'

export type AttentionTone = 'warn' | 'info' | 'danger'

export interface AttentionItem {
  icon: React.ElementType
  label: string
  detail?: string
  href: string
  tone: AttentionTone
}

const ICON_TONE: Record<AttentionTone, string> = {
  warn: 'text-amber-600',
  info: 'text-blue-600',
  danger: 'text-red-600',
}

/**
 * "Needs your attention" card — the amber banner style from the admin
 * pending-approvals widget, generalised to a list of linked rows. Renders
 * nothing when there are no items, so callers can drop it in unconditionally.
 */
export default function AttentionCard({ items, title = 'Needs your attention' }: { items: AttentionItem[]; title?: string }) {
  if (!items.length) return null
  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
        <h2 className="text-sm font-semibold text-amber-800">{title}</h2>
        <span className="text-xs text-amber-700">{items.length}</span>
      </div>
      <div className="divide-y divide-amber-100">
        {items.map((item, i) => (
          <Link
            key={`${item.href}-${i}`}
            href={item.href}
            className="flex items-center gap-3 py-2 -mx-1 px-1 rounded-lg hover:bg-amber-100/60 transition-colors group"
          >
            <item.icon className={`h-4 w-4 flex-shrink-0 ${ICON_TONE[item.tone]}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900 truncate">{item.label}</p>
              {item.detail && <p className="text-xs text-gray-500 truncate">{item.detail}</p>}
            </div>
            <ChevronRight className="h-4 w-4 text-amber-400 flex-shrink-0 group-hover:text-amber-600" />
          </Link>
        ))}
      </div>
    </div>
  )
}

export { AlertTriangle }
