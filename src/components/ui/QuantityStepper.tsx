'use client'

// A −/+ stepper with a typable field. Built for a thumb on a phone at a stores
// shelf: 44px targets, a numeric keypad, and press-and-hold to run a count up
// fast without forty taps.
//
// The field is held as a STRING so it can be emptied while typing — a number
// -typed state fights the user, turning a cleared box into 0 and then into "01".
// Same reason JobTypesManager keeps its reminder-hours input as a string.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Shown under the field, e.g. "boxes of 24". */
  hint?: string
  label?: string
  id?: string
  disabled?: boolean
  className?: string
}

const HOLD_DELAY_MS = 400
const HOLD_REPEAT_MS = 90

export function QuantityStepper({
  value, onChange, min = 0, max, step = 1, hint, label, id, disabled, className,
}: Props) {
  const [text, setText] = useState(String(value))
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({})

  // Follow the value when the parent resets it (dialog reopened, mode switched),
  // but never while the user is mid-edit with the box cleared.
  useEffect(() => {
    if (text !== '' && Number(text) === value) return
    setText(String(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const clamp = useCallback((n: number) => {
    if (Number.isNaN(n)) return min
    if (n < min) return min
    if (max !== undefined && n > max) return max
    return n
  }, [min, max])

  const bump = useCallback((delta: number) => {
    onChange(clamp((Number(text) || 0) + delta))
  }, [clamp, onChange, text])

  const stopHold = useCallback(() => {
    if (timers.current.delay) clearTimeout(timers.current.delay)
    if (timers.current.repeat) clearInterval(timers.current.repeat)
    timers.current = {}
  }, [])

  // Press-and-hold. The ref chase is deliberate: the interval closes over the
  // count it started with, so it tracks its own running total rather than
  // re-reading state that has not re-rendered yet.
  const startHold = useCallback((delta: number) => {
    bump(delta)
    let running = clamp((Number(text) || 0) + delta)
    timers.current.delay = setTimeout(() => {
      timers.current.repeat = setInterval(() => {
        running = clamp(running + delta)
        onChange(running)
      }, HOLD_REPEAT_MS)
    }, HOLD_DELAY_MS)
  }, [bump, clamp, onChange, text])

  useEffect(() => stopHold, [stopHold])

  const commit = (raw: string) => {
    // An empty box means zero on blur, not NaN.
    const n = raw.trim() === '' ? min : Number(raw)
    const next = clamp(n)
    setText(String(next))
    onChange(next)
  }

  const atMin = value <= min
  const atMax = max !== undefined && value >= max

  return (
    <div className={cn('space-y-1', className)}>
      {label && <label htmlFor={id} className="label-base">{label}</label>}
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          aria-label="Decrease"
          disabled={disabled || atMin}
          onPointerDown={() => startHold(-step)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className="btn-secondary min-h-11 w-12 shrink-0 items-center justify-center px-0"
        >
          <Minus className="h-4 w-4" />
        </button>

        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={text}
          disabled={disabled}
          onChange={e => {
            const raw = e.target.value.replace(/[^\d]/g, '')
            setText(raw)
            if (raw !== '') onChange(clamp(Number(raw)))
          }}
          onBlur={e => commit(e.target.value)}
          onFocus={e => e.target.select()}
          className="input-base min-h-11 flex-1 text-center text-lg tnum"
        />

        <button
          type="button"
          aria-label="Increase"
          disabled={disabled || atMax}
          onPointerDown={() => startHold(step)}
          onPointerUp={stopHold}
          onPointerLeave={stopHold}
          onPointerCancel={stopHold}
          className="btn-secondary min-h-11 w-12 shrink-0 items-center justify-center px-0"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  )
}
