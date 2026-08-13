'use client'

// The voyage number field, with the ghost-text suggestion Andrew asked for: when this
// vessel already has a recent draught survey carrying a voyage, offer that number in
// grey and let Tab or Enter accept it.
//
// It is a SUGGESTION, never a pre-filled value — the field submits empty unless the
// surveyor accepts. A vessel starting a genuinely new voyage must never be silently
// stamped with the last one, which is exactly the failure the whole voyage feature
// exists to prevent.
//
// Used by both New Job forms and both job-detail edit forms, so the normalisation and
// the accept gesture behave identically everywhere.

import { useRef, useState } from 'react'
import { normaliseVoyage } from '@/lib/jobs/voyage'

export interface VoyageNumberInputProps {
  value: string
  onChange: (v: string) => void
  /** The canonical value to offer, e.g. 'V-086'. Null = no suggestion. */
  suggestion?: string | null
  /** Why it is being offered, e.g. 'from Initial, 11 Aug'. */
  suggestionNote?: string | null
  id?: string
  placeholder?: string
  className?: string
  disabled?: boolean
}

export default function VoyageNumberInput({
  value, onChange, suggestion, suggestionNote,
  id, placeholder = 'e.g. V-086', className = 'input-base', disabled,
}: VoyageNumberInputProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const showGhost = !!suggestion && value.trim() === ''

  const accept = () => {
    if (!suggestion) return
    onChange(suggestion)
    // Put the caret at the end so the surveyor can immediately correct a digit.
    requestAnimationFrame(() => {
      const el = ref.current
      if (el) el.setSelectionRange(el.value.length, el.value.length)
    })
  }

  return (
    <div>
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          // Canonicalise on the way out, not on every keystroke: rewriting "V-0" to
          // "V-000" mid-type fights the surveyor. Anything unparseable is kept exactly
          // as typed — see normaliseVoyage.
          onBlur={() => { setFocused(false); const n = normaliseVoyage(value); if (n && n !== value) onChange(n) }}
          onKeyDown={e => {
            if (!showGhost) return
            if (e.key === 'Tab' || e.key === 'Enter') {
              // Tab still moves on afterwards; Enter must not submit the form on the
              // same keystroke that accepted the suggestion.
              if (e.key === 'Enter') e.preventDefault()
              accept()
            }
          }}
          className={className}
          placeholder={showGhost ? '' : placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {showGhost && (
          // Sits behind the (transparent-background) input, aligned to the same text
          // box. aria-hidden because the real hint for assistive tech is the note below.
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-gray-400 truncate"
          >
            {suggestion}
          </span>
        )}
      </div>
      {showGhost ? (
        <p className="text-xs text-gray-400 mt-1">
          <span className="text-gray-500">{suggestion}</span>
          {suggestionNote ? ` ${suggestionNote}` : ''}
          {' — press '}
          <kbd className="px-1 py-0.5 border border-gray-300 rounded text-[10px] font-sans">Tab</kbd>
          {' to use it, or just type a different one.'}
        </p>
      ) : (
        <p className="text-xs text-gray-400 mt-1">
          The vessel&apos;s voyage, e.g. <strong>V-086</strong>. It groups the Initial, Interim and Final
          draught surveys of one voyage so they bill as a single job.
        </p>
      )}
    </div>
  )
}
