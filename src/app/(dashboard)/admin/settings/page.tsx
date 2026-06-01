'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Save, Hash, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function JobNumberingSettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [notInstalled, setNotInstalled] = useState(false)

  const [prefix, setPrefix] = useState('TE-')
  const [padding, setPadding] = useState(5)
  const [nextNumber, setNextNumber] = useState(1001)
  const [livePreview, setLivePreview] = useState('')
  const [nextInput, setNextInput] = useState('')

  useEffect(() => {
    async function load() {
      const supabase = createClient()

      // Guard: super admins only
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_super_admin')
        .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
        .single()

      if (!profile?.is_super_admin) {
        router.replace('/admin')
        return
      }

      const { data, error: rpcErr } = await supabase.rpc('admin_get_job_numbering_info')
      if (rpcErr || !data) {
        // Detect the "function missing from schema cache" case (migration not applied)
        const msg = rpcErr?.message ?? ''
        if (/could not find the function|schema cache|does not exist/i.test(msg)) {
          setNotInstalled(true)
        } else {
          setError(msg || 'Failed to load numbering config')
        }
        setLoading(false)
        return
      }

      setPrefix(data.prefix)
      setPadding(data.padding)
      setNextNumber(data.next_number)
      setNextInput(String(data.next_number))
      setLivePreview(data.preview)
      setLoading(false)
    }
    load()
  }, [router])

  // Live preview of prefix+padding changes
  useEffect(() => {
    const padded = String(nextNumber).padStart(padding, '0')
    setLivePreview(`${prefix}${padded}`)
  }, [prefix, padding, nextNumber])

  async function handleSaveConfig() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    const supabase = createClient()
    const { data, error: rpcErr } = await supabase.rpc('admin_update_job_numbering_config', {
      p_prefix: prefix,
      p_padding: padding,
    })
    setSaving(false)
    if (rpcErr || !data?.ok) {
      setError(rpcErr?.message ?? 'Failed to save config')
    } else {
      setSuccess(`Config saved. Next number will be: ${data.preview}`)
    }
  }

  async function handleSetNextNumber() {
    const n = parseInt(nextInput, 10)
    if (isNaN(n) || n < 1) { setError('Next number must be a positive integer'); return }

    setResetting(true)
    setError(null)
    setSuccess(null)
    const supabase = createClient()
    const { data, error: rpcErr } = await supabase.rpc('admin_set_next_job_number', { next_num: n })
    setResetting(false)

    if (rpcErr || !data?.ok) {
      setError(rpcErr?.message ?? 'Failed to set next number')
    } else {
      setNextNumber(n)
      setSuccess(`Done — next checklist will be: ${data.preview}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  if (notInstalled) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="page-title">Job Numbering Settings</h1>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-5 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 space-y-2">
            <p className="font-semibold">Numbering settings are not installed in Supabase</p>
            <p>The database functions that power this page are missing. Run migration <strong>014_job_numbering_config.sql</strong> (and migration 015) in the Supabase SQL Editor, then reload this page.</p>
            <p className="text-xs">If you just ran the migration, run <code className="bg-amber-100 px-1 rounded">NOTIFY pgrst, &apos;reload schema&apos;;</code> to refresh the API schema cache.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Job Numbering Settings</h1>
        <p className="text-gray-500 mt-1 text-sm">Super admin only — controls how checklist/job numbers are formatted and what number comes next.</p>
      </div>

      {/* Info banner */}
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800 space-y-1">
          <p className="font-semibold">Important — about deleted job numbers</p>
          <p>Deleted job numbers are <strong>reserved</strong> and will never be reused. The sequence only moves forward. Setting &ldquo;next number&rdquo; to a value already assigned to any checklist (active or deleted) is blocked.</p>
        </div>
      </div>

      {/* Current state */}
      <div className="card p-5 space-y-1">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Current next checklist number</p>
        <div className="flex items-center gap-3 mt-1">
          <Hash className="h-5 w-5 text-brand-600" />
          <span className="text-2xl font-bold text-brand-700 font-mono">{livePreview}</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">{success}</div>
      )}

      {/* Format config */}
      <div className="card p-5 space-y-4">
        <h2 className="section-title">Number Format</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label-base">Prefix</label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => { setPrefix(e.target.value); setError(null); setSuccess(null) }}
              className="input-base font-mono"
              placeholder="TEAL C/L #"
              maxLength={20}
            />
            <p className="text-xs text-gray-400 mt-1">e.g. &ldquo;TE-&rdquo;, &ldquo;TEAL-&rdquo;, &ldquo;JOB-&rdquo;</p>
          </div>
          <div>
            <label className="label-base">Number padding (digits)</label>
            <input
              type="number"
              value={padding}
              onChange={(e) => { setPadding(Math.max(1, Math.min(10, parseInt(e.target.value) || 1))); setError(null); setSuccess(null) }}
              className="input-base"
              min={1}
              max={10}
            />
            <p className="text-xs text-gray-400 mt-1">5 → TE-01007, 4 → TE-1007</p>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <p className="text-xs text-gray-500 mb-0.5">Format preview</p>
          <p className="font-mono text-lg font-semibold text-gray-900">{livePreview}</p>
        </div>

        <button onClick={handleSaveConfig} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Format'}
        </button>
      </div>

      {/* Next number reset */}
      <div className="card p-5 space-y-4">
        <h2 className="section-title">Set Next Number</h2>
        <p className="text-sm text-gray-500">
          Change what number the next created checklist will receive. The number must not already be assigned to any existing checklist.
        </p>

        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="label-base">Next number (integer)</label>
            <input
              type="number"
              value={nextInput}
              onChange={(e) => { setNextInput(e.target.value); setError(null); setSuccess(null) }}
              className="input-base font-mono"
              min={1}
              placeholder="e.g. 2001"
            />
          </div>
          <div className="flex-shrink-0 pb-0.5">
            <p className="text-xs text-gray-500 mb-1">Preview</p>
            <p className="font-mono text-sm font-semibold text-gray-700">
              {prefix}{String(parseInt(nextInput) || 0).padStart(padding, '0')}
            </p>
          </div>
        </div>

        <button onClick={handleSetNextNumber} disabled={resetting} className="btn-secondary">
          {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hash className="h-4 w-4" />}
          {resetting ? 'Applying…' : 'Set Next Number'}
        </button>
      </div>
    </div>
  )
}
