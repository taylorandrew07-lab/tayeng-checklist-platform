'use client'

// How long something took, asked the two ways it is actually known.
//
// Sometimes you know the clock — "on board 09:00 to 17:00" — and sometimes you only know
// the duration — "about half an hour on the phone". The app used to insist on the second
// on one card and offer a fixed dropdown on the other, so the first had to be worked out
// in your head and the times themselves were lost.
//
// One control, one toggle, one of the two on screen at a time. The MINUTES are what gets
// stored and billed either way; the clock is a calculator sitting in front of them, and
// the times are kept as well so the line can say when the work happened.
//
// A finish earlier than the start ran past midnight. That is not an error and it is not a
// negative number — it is the same wrap the job overtime log has used since mig 111.

import { formatMinutes, minutesFromHM, minutesFromSpan, hmFromMinutes } from '@/lib/cases/minutes'

export interface DurationValue {
  mode: 'hm' | 'span'
  h: string
  m: string
  from: string
  to: string
}

export const BLANK_DURATION: DurationValue = { mode: 'hm', h: '', m: '', from: '', to: '' }

/** The one number that matters. Whichever way it was entered. */
export function durationMinutes(v: DurationValue): number {
  return v.mode === 'span' ? minutesFromSpan(v.from, v.to) : minutesFromHM(v.h, v.m)
}

/** What to send to the database: the times only when the clock is what was entered, so a
 *  duration typed by hand never leaves a stale span behind it on the row. */
export function durationTimes(v: DurationValue): { start_time: string | null; end_time: string | null } {
  return v.mode === 'span' && v.from && v.to
    ? { start_time: v.from, end_time: v.to }
    : { start_time: null, end_time: null }
}

/** A stored row back into the control — in the mode it was entered in. */
export function durationFromRow(
  minutes: number | null | undefined, from: string | null, to: string | null,
): DurationValue {
  const { hours, mins } = hmFromMinutes(minutes ?? 0)
  return {
    mode: from && to ? 'span' : 'hm',
    h: hours ? String(hours) : '',
    m: mins ? String(mins) : '',
    from: from ? from.slice(0, 5) : '',
    to: to ? to.slice(0, 5) : '',
  }
}

export default function DurationField({ value, onChange, label = 'Time spent' }: {
  value: DurationValue
  onChange: (v: DurationValue) => void
  label?: string
}) {
  const minutes = durationMinutes(value)
  const set = (patch: Partial<DurationValue>) => onChange({ ...value, ...patch })

  return (
    <div>
      <span className="label-base">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-gray-300 overflow-hidden h-[38px]">
          {([['hm', 'Hours'], ['span', 'From–To']] as const).map(([m, text]) => (
            <button key={m} type="button" onClick={() => set({ mode: m })} aria-pressed={value.mode === m}
              className={`px-3 text-xs transition-colors ${
                value.mode === m ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {text}
            </button>
          ))}
        </div>

        {value.mode === 'hm' ? (
          <div className="flex items-center gap-1">
            <input aria-label="Hours" type="number" min="0" inputMode="numeric" placeholder="0"
              className="input-base w-16 text-right tnum" value={value.h}
              onChange={e => set({ h: e.target.value })} />
            <span className="text-sm text-gray-500">h</span>
            <input aria-label="Minutes" type="number" min="0" step="5" inputMode="numeric" placeholder="0"
              className="input-base w-16 text-right tnum" value={value.m}
              onChange={e => set({ m: e.target.value })} />
            <span className="text-sm text-gray-500">m</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input aria-label="From" type="time" className="input-base w-28 tnum" value={value.from}
              onChange={e => set({ from: e.target.value })} />
            <span className="text-sm text-gray-500">to</span>
            <input aria-label="To" type="time" className="input-base w-28 tnum" value={value.to}
              onChange={e => set({ to: e.target.value })} />
            <span className="text-sm text-gray-700 tnum w-20 pl-1">
              {value.from && value.to ? formatMinutes(minutes) : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
