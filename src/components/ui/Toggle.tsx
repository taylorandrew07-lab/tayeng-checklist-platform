'use client'

// The one accessible on/off switch for the app. role="switch" + aria-checked so
// screen readers announce it, a real <button> so Space/Enter work, a visible focus
// ring, and a subtle press. Replaces the hand-rolled div-onClick toggles that were
// invisible to keyboard + screen-reader users.
//
//   <Toggle checked={x} onChange={setX} label="Include in PDF" />

import { cn } from '@/lib/utils'

interface Props {
  checked: boolean
  onChange: (next: boolean) => void
  label?: string
  /** Put the label before the switch instead of after. */
  labelPosition?: 'before' | 'after'
  disabled?: boolean
  className?: string
  id?: string
}

export function Toggle({ checked, onChange, label, labelPosition = 'after', disabled, className, id }: Props) {
  const track = (
    <span
      className={cn(
        'relative h-6 w-10 flex-shrink-0 rounded-full transition-colors duration-150 ease-out',
        checked ? 'bg-brand-600' : 'bg-gray-300',
        disabled && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150 ease-out',
          checked ? 'translate-x-5' : 'translate-x-1',
        )}
      />
    </span>
  )
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label ? undefined : 'Toggle'}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex select-none items-center gap-2 rounded-lg',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
        'active:scale-[0.98] disabled:cursor-not-allowed',
        className,
      )}
    >
      {label && labelPosition === 'before' && <span className="text-sm font-medium text-gray-700">{label}</span>}
      {track}
      {label && labelPosition === 'after' && <span className="text-sm font-medium text-gray-700">{label}</span>}
    </button>
  )
}
