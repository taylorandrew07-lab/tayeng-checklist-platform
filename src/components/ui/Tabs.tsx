'use client'

import { cn } from '@/lib/utils'

// One tab bar for the whole app: underline-style tabs with the brand active state,
// optional per-tab count badge, horizontal scroll on overflow. Replaces the inline
// `border-b-2 -mb-px` tab markup each surface grew on its own.

export interface TabItem {
  key: string
  label: React.ReactNode
  /** Optional count badge (shown only when > 0), e.g. the Reconcile flag count. */
  badge?: number
}

export default function Tabs({ tabs, active, onChange, className }: {
  tabs: TabItem[]
  active: string
  onChange: (key: string) => void
  className?: string
}) {
  return (
    <div className={cn('flex gap-0.5 border-b border-gray-200 overflow-x-auto', className)}>
      {tabs.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            // py-3 on mobile keeps a ~44px touch target; compact (py-2) on desktop.
            'px-3.5 py-3 sm:py-2 text-sm font-medium border-b-2 -mb-px rounded-t-md transition-colors flex items-center gap-1.5 whitespace-nowrap',
            active === t.key
              ? 'border-brand-600 text-brand-700 bg-brand-50/60'
              : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50',
          )}
        >
          {t.label}
          {t.badge != null && t.badge > 0 && (
            <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-yellow-400 text-yellow-900 text-[11px] font-semibold tnum">{t.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
