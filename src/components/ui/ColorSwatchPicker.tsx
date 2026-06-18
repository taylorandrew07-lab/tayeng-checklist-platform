'use client'

// Reusable palette picker: renders the curated JOB_PALETTE as clickable chips plus
// a "None" option. Stores/returns a palette KEY (or null). Used to colour-code
// clients and job types.

import { Check } from 'lucide-react'
import { JOB_PALETTE } from '@/lib/jobs/colors'

export default function ColorSwatchPicker({ value, onChange }: {
  value: string | null
  onChange: (key: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(null)}
        title="No colour"
        className={`h-7 w-7 rounded-full border flex items-center justify-center text-[10px] text-gray-400 bg-white ${value == null ? 'ring-2 ring-brand-500 border-brand-500' : 'border-gray-300 hover:border-gray-400'}`}
      >
        {value == null ? <Check className="h-3.5 w-3.5 text-brand-600" /> : '—'}
      </button>
      {JOB_PALETTE.map(opt => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          title={opt.label}
          aria-label={opt.label}
          style={{ backgroundColor: opt.bg, color: opt.fg }}
          className={`h-7 w-7 rounded-full border flex items-center justify-center ${value === opt.key ? 'ring-2 ring-brand-500 border-brand-500' : 'border-black/10 hover:border-black/25'}`}
        >
          {value === opt.key && <Check className="h-3.5 w-3.5" />}
        </button>
      ))}
    </div>
  )
}
