'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, CircleDashed } from 'lucide-react'
import type { ReviewItem } from '@/lib/checklist/review'

/**
 * The last thing a surveyor looks at before leaving the vessel.
 *
 * Two questions, both of which used to be answerable only after the fact — the blanks
 * by pressing submit and reading the rejection, the findings by generating the report
 * and reading it. Neither is any use standing on a deck about to step off.
 *
 * Both lists come from lib/checklist/review, which is also what prints the report's
 * deficiency summary. The findings list here and the defect list in the PDF are the
 * same list from the same walk — they cannot disagree.
 *
 * Collapsed by default: this sits under a ~170-question form and must not push the
 * finish button off the screen. The counts are the point; the rows are for acting on.
 */
export function ChecklistReviewPanel({
  unanswered,
  findings,
  onJump,
}: {
  unanswered: ReviewItem[]
  findings: ReviewItem[]
  /** Scroll to and focus a question. Given instanceKey(fieldId, instance). A read-only
   *  viewer jumps too — seeing the question in context is the point either way. */
  onJump: (key: string) => void
}) {
  const [open, setOpen] = useState<'blank' | 'findings' | null>(null)

  const reds = findings.filter(f => f.severity === 'red').length
  const ambers = findings.length - reds
  const toggle = (which: 'blank' | 'findings') => setOpen(prev => (prev === which ? null : which))

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="font-semibold text-gray-900">Before you finish</h3>
        {unanswered.length === 0 && findings.length === 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-green-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> Nothing outstanding
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <SummaryButton
          active={open === 'blank'}
          onClick={() => toggle('blank')}
          disabled={unanswered.length === 0}
          icon={<CircleDashed className="h-4 w-4 flex-shrink-0" />}
          tone={unanswered.length ? 'amber' : 'quiet'}
          count={unanswered.length}
          label={unanswered.length === 1 ? 'question unanswered' : 'questions unanswered'}
        />
        <SummaryButton
          active={open === 'findings'}
          onClick={() => toggle('findings')}
          disabled={findings.length === 0}
          icon={<AlertTriangle className="h-4 w-4 flex-shrink-0" />}
          tone={reds ? 'red' : findings.length ? 'amber' : 'quiet'}
          count={findings.length}
          label={findings.length === 1 ? 'finding' : 'findings'}
          // Spelling out the split matters: amber is "nobody could inspect it", which
          // is a different conversation with the client than a straight failure.
          hint={findings.length ? `${reds} red · ${ambers} amber` : undefined}
        />
      </div>

      {open === 'blank' && (
        <ReviewList
          items={unanswered}
          onJump={onJump}
          empty="Every question on this checklist has an answer."
        />
      )}

      {open === 'findings' && (
        <>
          <ReviewList
            items={findings}
            onJump={onJump}
            empty="No answer on this checklist reads as a finding."
          />
          <p className="text-xs text-gray-500">
            This is the defect list. It prints in the report exactly as it reads here.
          </p>
        </>
      )}
    </div>
  )
}

function SummaryButton({
  active, onClick, disabled, icon, tone, count, label, hint,
}: {
  active: boolean
  onClick: () => void
  disabled: boolean
  icon: React.ReactNode
  tone: 'red' | 'amber' | 'quiet'
  count: number
  label: string
  hint?: string
}) {
  const tones = {
    red: 'border-red-200 bg-red-50 text-red-800 hover:bg-red-100',
    amber: 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100',
    quiet: 'border-gray-200 bg-gray-50 text-gray-500',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={active}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${tones[tone]}`}
    >
      {icon}
      <span className="flex-1 min-w-0">
        <span className="font-semibold">{count}</span> {label}
        {hint && <span className="block text-xs opacity-75">{hint}</span>}
      </span>
      {!disabled && (
        <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${active ? 'rotate-180' : ''}`} />
      )}
    </button>
  )
}

function ReviewList({
  items, onJump, empty,
}: {
  items: ReviewItem[]
  onJump: (key: string) => void
  empty: string
}) {
  if (items.length === 0) return <p className="text-sm text-gray-500">{empty}</p>
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 max-h-80 overflow-y-auto">
      {items.map(item => (
        <li key={item.key}>
          <button
            type="button"
            onClick={() => onJump(item.key)}
            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-start gap-2"
          >
            {item.severity && (
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${item.severity === 'red' ? 'bg-red-500' : 'bg-amber-500'}`}
              />
            )}
            <span className="flex-1 min-w-0">
              <span className="text-sm text-gray-800">
                {item.itemNumber && <span className="font-medium text-gray-500">{item.itemNumber} </span>}
                {item.label}
              </span>
              {item.remark && <span className="block text-xs text-gray-500 mt-0.5">{item.remark}</span>}
            </span>
            {item.answer && (
              <span className={`text-[11px] font-semibold flex-shrink-0 mt-0.5 ${item.severity === 'red' ? 'text-red-700' : 'text-amber-700'}`}>
                {item.answer}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
