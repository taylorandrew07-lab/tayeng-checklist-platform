'use client'

// Shared editor for a list of invoice line items — fees, manual lines and
// reimbursable expenses (each expense can carry an attached vendor receipt with an
// editable value). Used by both the Create-invoice builder (for extra/expense
// lines) and the invoice editor (for every line). Job-linked lines show their
// vessel and can't be removed here (unlink from the job instead).

import { useState } from 'react'
import { Plus, X, Loader2, Upload, FileText } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { money } from '@/lib/jobs/tracker'
import { uploadInvoiceReceipt, invoiceReceiptUrl } from '@/lib/jobs/invoicing'
import type { Currency } from '@/lib/types/database'

export interface DraftLine {
  key: string
  description: string
  qty: number
  unit_price: number
  is_expense: boolean
  receipt_path: string | null
  receipt_name: string | null
  job_id: string | null
  vessel_name?: string | null
  report_number?: string | null
  /** Auto-seeded mileage line (per_km rate × job km); replaced on each reload. */
  auto_mileage?: boolean
}

export function blankLine(is_expense = false): DraftLine {
  return { key: crypto.randomUUID(), description: '', qty: 1, unit_price: 0, is_expense, receipt_path: null, receipt_name: null, job_id: null }
}

export default function LineItemsEditor({ lines, setLines, currency }: {
  lines: DraftLine[]
  setLines: (updater: (prev: DraftLine[]) => DraftLine[]) => void
  currency: Currency
}) {
  const [uploadingKey, setUploadingKey] = useState<string | null>(null)

  const patch = (key: string, p: Partial<DraftLine>) => setLines(prev => prev.map(l => l.key === key ? { ...l, ...p } : l))
  const remove = (key: string) => setLines(prev => prev.filter(l => l.key !== key))
  const add = (is_expense: boolean) => setLines(prev => [...prev, blankLine(is_expense)])

  async function upload(key: string, file: File | undefined) {
    if (!file) return
    setUploadingKey(key)
    const res = await uploadInvoiceReceipt(file)
    setUploadingKey(null)
    if (res.error) { toast.error(res.error); return }
    patch(key, { receipt_path: res.path ?? null, receipt_name: file.name })
  }
  async function view(path: string) {
    const url = await invoiceReceiptUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    else toast.error('Could not open the receipt')
  }

  const cell = 'input-base py-1 text-sm'
  return (
    <div className="space-y-2">
      {lines.map(l => {
        const amount = (Number(l.qty) || 0) * (Number(l.unit_price) || 0)
        return (
          <div key={l.key} className="rounded-lg border border-gray-100 p-2.5 space-y-2">
            {l.job_id && (
              <p className="text-[11px] text-gray-400">{[l.report_number, l.vessel_name ? `M.V. ${l.vessel_name}` : null].filter(Boolean).join(' · ') || 'Linked job'}</p>
            )}
            <div className="grid grid-cols-[1fr_3rem_5.5rem_5rem_auto] gap-2 items-center">
              <input value={l.description} onChange={e => patch(l.key, { description: e.target.value })} placeholder={l.is_expense ? 'e.g. Launch' : 'Description'} className={cell} />
              <input type="number" min={0} step="0.5" value={l.qty} onChange={e => patch(l.key, { qty: Number(e.target.value) })} className={`${cell} text-right`} />
              <input type="number" min={0} step="0.01" value={l.unit_price} onChange={e => patch(l.key, { unit_price: Number(e.target.value) })} className={`${cell} text-right`} />
              <span className="text-sm text-gray-700 text-right tnum">{amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <button onClick={() => remove(l.key)} disabled={!!l.job_id} title={l.job_id ? 'Linked to a job — edit on the job instead' : 'Remove line'} className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* A vessel's job-linked survey-fee line can't be flipped to an expense
                  (it would mis-bill it); only standalone/manual lines are toggleable. */}
              <label className={`flex items-center gap-1.5 text-xs ${l.job_id ? 'text-gray-300 cursor-not-allowed' : 'text-gray-500 cursor-pointer'}`} title={l.job_id ? 'Linked to a job — not an expense' : undefined}>
                <input type="checkbox" checked={l.is_expense} disabled={!!l.job_id} onChange={e => patch(l.key, { is_expense: e.target.checked })} /> Reimbursable expense
              </label>
              {l.is_expense && (l.receipt_path ? (
                <span className="inline-flex items-center gap-1.5 text-xs">
                  <button onClick={() => view(l.receipt_path!)} className="text-brand-600 hover:underline inline-flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{l.receipt_name || 'Receipt'}</button>
                  <button onClick={() => patch(l.key, { receipt_path: null, receipt_name: null })} className="text-gray-400 hover:text-red-600" title="Remove receipt"><X className="h-3 w-3" /></button>
                </span>
              ) : (
                <label className="text-xs text-brand-600 hover:underline cursor-pointer inline-flex items-center gap-1">
                  {uploadingKey === l.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Attach receipt
                  <input type="file" accept="image/*,application/pdf" className="hidden" onChange={e => upload(l.key, e.target.files?.[0])} />
                </label>
              ))}
              <span className="ml-auto text-xs text-gray-400 tnum">{money(amount, currency)}</span>
            </div>
          </div>
        )
      })}
      <div className="flex gap-2">
        <button onClick={() => add(false)} className="btn-ghost py-1 px-2 text-xs text-brand-600"><Plus className="h-3.5 w-3.5" /> Add line</button>
        <button onClick={() => add(true)} className="btn-ghost py-1 px-2 text-xs text-brand-600"><Plus className="h-3.5 w-3.5" /> Add expense</button>
      </div>
    </div>
  )
}
