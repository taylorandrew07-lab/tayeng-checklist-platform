'use client'

// Email summary + derived pass/fail for an Ultrasonic Hatch Testing job. Shown on
// the job detail page when the job's template is the UHT template. Reads the job's
// field values and runs the pure generator in src/lib/uht/email.ts.

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { generateUhtEmail, formatLongDate, formatTime, holdList, type UhtResult } from '@/lib/uht/email'
import { toast } from '@/components/ui/toast'
import { Copy, Mail, RefreshCw, CheckCircle2, Clock, FileText, Loader2 } from 'lucide-react'

export default function UhtSummary({ jobId, vesselName, clientName }: { jobId: string; vesselName?: string | null; clientName?: string | null }) {
  const [result, setResult] = useState<UhtResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [greeting, setGreeting] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const sb = createClient()
    const { data } = await sb.from('job_field_values').select('field_id, value').eq('job_id', jobId)
    const values: Record<string, string> = {}
    for (const r of (data ?? []) as { field_id: string; value: string | null }[]) values[r.field_id] = r.value ?? ''
    setResult(generateUhtEmail({ vesselName, clientName, values }))
    setLoading(false)
  }, [jobId, vesselName, clientName])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="card p-5 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-brand-600" /></div>
  if (!result) return null

  const fullText = (greeting ? 'Good day all,\n\n' : '') + (result.body || 'No test data entered yet.')
  const mailto = `mailto:?subject=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(fullText)}`
  const hasData = result.rounds.length > 0

  const statusBadge =
    result.status === 'passed' ? <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />Passed</span>
    : result.status === 'open' ? <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><Clock className="h-3.5 w-3.5" />Open — re-test pending</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">No test data yet</span>

  async function copy() {
    try { await navigator.clipboard.writeText(fullText); toast.success('Email summary copied') }
    catch { toast.error('Could not copy — select the text and copy manually') }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="section-title flex items-center gap-2"><FileText className="h-4 w-4 text-brand-600" />Ultrasonic test summary</h2>
        <div className="flex items-center gap-2">
          {statusBadge}
          <button onClick={load} aria-label="Refresh" className="btn-ghost py-1 px-1.5 text-gray-400 hover:text-gray-700"><RefreshCw className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* Per-visit recap */}
      {hasData ? (
        <div className="space-y-2">
          {result.rounds.map(r => (
            <div key={r.key} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
              <div className="flex items-center justify-between flex-wrap gap-x-3">
                <span className="font-medium text-gray-800">{r.label}</span>
                <span className="text-xs text-gray-500 tnum">{formatLongDate(r.date) || '—'}{r.start && r.end ? ` · ${formatTime(r.start)}–${formatTime(r.end)}` : ''}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                {r.passed.length > 0 && <span className="text-green-700">Passed: {holdList(r.passed)}</span>}
                {r.failed.length > 0 && <span className="text-red-600">Failed: {holdList(r.failed)}</span>}
                <span className={r.bilges === 'pass' ? 'text-gray-500' : r.bilges === 'fail' ? 'text-red-600' : 'text-gray-400'}>
                  Bilges: {r.bilges === 'pass' ? 'clean & dry' : r.bilges === 'fail' ? 'not clean/dry' : '—'}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400">Enter the test date, times and per-hold results in the checklist to generate the email.</p>
      )}

      {/* Email body */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-gray-500">Email summary</span>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 select-none">
            <input type="checkbox" checked={greeting} onChange={e => setGreeting(e.target.checked)} className="h-3.5 w-3.5 rounded border-gray-300 text-brand-600" />
            “Good day all” greeting
          </label>
        </div>
        <pre className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">{fullText}</pre>
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={copy} disabled={!hasData} className="btn-secondary"><Copy className="h-4 w-4" />Copy</button>
          <a href={mailto} className={`btn-secondary ${!hasData ? 'pointer-events-none opacity-50' : ''}`}><Mail className="h-4 w-4" />Open in email</a>
        </div>
      </div>
    </div>
  )
}
