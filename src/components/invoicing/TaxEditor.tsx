'use client'

// Shared, presentational invoice taxes grid + the Subtotal/Tax/Total summary.
// Extracted verbatim from ConsolidatedInvoiceBuilder and InvoiceEditModal so the
// two stay in sync; markup/classes are unchanged. Driven entirely by props.

import { Plus, X } from 'lucide-react'
import { Dispatch, SetStateAction } from 'react'
import { money } from '@/lib/jobs/tracker'
import { computeTotals, type LineDraft, type TaxDraft } from '@/lib/jobs/invoicing'

const cell = 'input-base py-1 text-sm'

/** Editable list of taxes (name + % + live per-row amount, add/remove). `lines`
 *  are the current line drafts so each row can show its own tax amount. */
export function TaxEditor({ taxes, setTaxes, lines }: {
  taxes: TaxDraft[]
  setTaxes: Dispatch<SetStateAction<TaxDraft[]>>
  lines: LineDraft[]
}) {
  const setTax = (i: number, patch: Partial<TaxDraft>) => setTaxes(ts => ts.map((t, j) => j === i ? { ...t, ...patch } : t))
  return (
    <div className="space-y-2">
      {taxes.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2 items-center">
          <input value={t.name} onChange={e => setTax(i, { name: e.target.value })} placeholder="Tax name" className={cell} />
          <div className="relative"><input type="number" min={0} step="0.01" value={t.rate} onChange={e => setTax(i, { rate: Number(e.target.value) })} className={`${cell} text-right pr-5`} /><span className="absolute right-2 top-1.5 text-xs text-gray-400">%</span></div>
          <span className="text-sm text-gray-700 text-right tnum">{computeTotals(lines, [t]).tax_total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <button onClick={() => setTaxes(ts => ts.filter((_, j) => j !== i))} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <button onClick={() => setTaxes(ts => [...ts, { name: 'VAT', rate: 0 }])} className="btn-ghost py-1 px-2 text-xs text-brand-600"><Plus className="h-3.5 w-3.5" /> Add tax</button>
    </div>
  )
}

/** Subtotal / Tax / Total summary for the given line drafts + taxes. */
export function TotalsSummary({ lines, taxes, currency }: {
  lines: LineDraft[]
  taxes: TaxDraft[]
  currency: string
}) {
  const totals = computeTotals(lines, taxes)
  return (
    <div className="border-t border-gray-100 pt-3 space-y-1 text-sm">
      <div className="flex justify-between text-gray-500"><span>Subtotal</span><span className="tnum">{money(totals.subtotal, currency)}</span></div>
      {totals.tax_total > 0 && <div className="flex justify-between text-gray-500"><span>Tax</span><span className="tnum">{money(totals.tax_total, currency)}</span></div>}
      <div className="flex justify-between font-semibold text-gray-900"><span>Total</span><span className="tnum">{money(totals.total, currency)}</span></div>
    </div>
  )
}
