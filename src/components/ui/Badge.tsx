// Generic one-off status chip. Use a domain pill (StatusPill) where one exists;
// reach for Badge only for ad-hoc chips (Default, OT, sync error/pending, …) so
// they at least share one visual language instead of being re-styled per screen.

import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warn' | 'danger'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-600',
  brand: 'bg-brand-100 text-brand-700',
  success: 'bg-green-100 text-green-700',
  warn: 'bg-amber-100 text-amber-700',
  danger: 'bg-red-100 text-red-700',
}

export function Badge({ tone = 'neutral', children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TONE[tone]} ${className ?? ''}`}>
      {children}
    </span>
  )
}
