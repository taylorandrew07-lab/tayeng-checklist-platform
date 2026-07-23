'use client'

// One "pick exactly one" control for the whole app: period pickers, filters,
// colour-by, billing-mode, etc. Replaces the 4+ hand-rolled pill/segment styles
// (underline tabs, brand rounded-full pills, white-shadow segments). Reserve the
// <Tabs> primitive for page/section tabs; use this for in-content option switches.
//
//   <SegmentedControl value={period} onChange={setPeriod} options={[
//     { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' },
//   ]} />

import { cn } from '@/lib/utils'

export interface SegmentOption<T extends string> {
  value: T
  label: React.ReactNode
}

interface Props<T extends string> {
  value: T
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  /** Accessible group name. */
  ariaLabel?: string
  size?: 'sm' | 'md'
  className?: string
}

export function SegmentedControl<T extends string>({ value, onChange, options, ariaLabel, size = 'md', className }: Props<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-lg bg-gray-100 p-0.5', className)}
    >
      {options.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-md font-medium',
              // ≥44px tap target on phones (a11y), tightens on desktop.
              size === 'sm' ? 'px-2.5 py-2 text-xs sm:py-1' : 'px-3 py-2.5 text-sm sm:py-1.5',
              'transition-colors duration-150 ease-out',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1',
              'active:scale-[0.98]',
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-800',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
