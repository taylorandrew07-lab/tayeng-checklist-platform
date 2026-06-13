'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Save, WifiOff } from 'lucide-react'
import Link from 'next/link'
import { loadNewJobData } from '@/lib/offline/newJobData'
import { putDraft, offlineAvailable } from '@/lib/offline/db'
import { syncDraft } from '@/lib/offline/sync'

function formatDateDMY(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${d}-${m}-${date.getFullYear()}`
}

export default function SurveyorNewChecklistPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<any[]>([])
  const [clients, setClients] = useState<any[]>([])
  const [myName, setMyName] = useState('')
  const [fromCache, setFromCache] = useState(false)
  const [online, setOnline] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [templateId, setTemplateId] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null)
  const [vesselName, setVesselName] = useState('')
  const [clientId, setClientId] = useState('')
  const [newClientName, setNewClientName] = useState('')
  const [showNewClient, setShowNewClient] = useState(false)

  const today = formatDateDMY(new Date())
  const autoTitle = vesselName.trim() && selectedTemplate
    ? `M.V. ${vesselName.trim()} - ${selectedTemplate.name} - ${today}`
    : ''

  useEffect(() => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    const onStatus = () => setOnline(navigator.onLine)
    window.addEventListener('online', onStatus)
    window.addEventListener('offline', onStatus)
    async function load() {
      // The surveyor IS the surveyor on their own jobs — use their own name,
      // read offline-safely from the cached profile (falls back to a live fetch).
      let name = ''
      try { const c = localStorage.getItem('te_profile'); if (c) name = JSON.parse(c)?.full_name ?? '' } catch { /* storage unavailable */ }
      if (!name && (typeof navigator === 'undefined' || navigator.onLine)) {
        try {
          const supabase = createClient()
          const { data: { user } } = await supabase.auth.getUser()
          if (user) { const { data: p } = await supabase.from('profiles').select('full_name').eq('id', user.id).single(); name = p?.full_name ?? '' }
        } catch { /* offline / no session */ }
      }
      setMyName(name)
      const d = await loadNewJobData()
      setTemplates(d.templates)
      setClients(d.clients)
      setFromCache(d.fromCache)
      setLoading(false)
    }
    load()
    return () => { window.removeEventListener('online', onStatus); window.removeEventListener('offline', onStatus) }
  }, [])

  function handleTemplateChange(id: string) {
    setTemplateId(id)
    setSelectedTemplate(templates.find(t => t.id === id) ?? null)
  }
  function handleClientChange(val: string) {
    if (val === '__new__') { setShowNewClient(true); setClientId('') }
    else { setShowNewClient(false); setNewClientName(''); setClientId(val) }
  }

  async function handleCreate() {
    if (!templateId || !selectedTemplate) return setError('Please select a template')
    if (!vesselName.trim()) return setError('Vessel name is required')
    const finalSurveyor = myName.trim()
    if (!finalSurveyor) return setError('Could not read your name — reconnect once so your profile loads.')

    setSaving(true)
    setError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id
      if (!userId) throw new Error('Your session has expired — please sign in again.')
      if (!offlineAvailable()) throw new Error('Local storage is unavailable on this device.')

      let finalClientId: string | null = clientId || null

      // "Request new" client/surveyor needs the network — only when online.
      if (online && showNewClient && newClientName.trim()) {
        await supabase.from('client_requests').insert({ requested_name: newClientName.trim(), requested_by: userId })
        fetch('/api/notify/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'client_request', requestedName: newClientName.trim() }) }).catch(() => {})
        finalClientId = null
      }
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const job = {
        id, title: autoTitle, template_id: templateId, template: { id: templateId, name: selectedTemplate.name },
        vessel_name: vesselName.trim(), surveyor_name: finalSurveyor,
        client_id: finalClientId, client: finalClientId ? { name: clients.find(c => c.id === finalClientId)?.name ?? '' } : null,
        status: 'in_progress', created_by: userId, assigned_to: userId, started_at: now, job_number: null,
      }

      // Create the job locally first (works with no signal). It syncs — creating
      // the server row + answers — when the device next reaches Supabase.
      await putDraft({
        key: '', jobId: id, userId, job, sections: selectedTemplate.sections ?? [],
        values: {}, arrayValues: {}, signatures: {}, fieldPhotos: {}, generalPhotos: [],
        serverValues: {}, serverArrayValues: {}, serverSignatures: {},
        pendingSubmit: false, pendingCreate: true, dirty: true, needsSync: true,
        updatedAt: Date.now(), lastSyncedAt: null, syncError: null,
      })

      // If we have a connection, publish immediately so it appears on dashboards now.
      if (online) { try { await syncDraft(supabase, id) } catch { /* manager retries */ } }

      router.push(`/surveyor/jobs/${id}`)
    } catch (err: any) {
      setError(err?.message ?? 'Could not start the checklist — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }
  if (templates.length === 0) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">No Templates Available</h1>
        <p className="text-gray-500 mb-6">{fromCache ? 'No templates are saved on this device yet. Connect to the internet once to download them.' : 'There are no templates you can start. Contact your administrator.'}</p>
        <Link href="/surveyor" className="btn-secondary">Back to Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/surveyor" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="page-title">New Job</h1>
          <p className="text-gray-500 mt-0.5">Create a new survey checklist</p>
        </div>
      </div>

      {!online && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center gap-2">
          <WifiOff className="h-4 w-4 flex-shrink-0" />You&apos;re offline. The checklist will be saved on this device and sync automatically when you reconnect.
        </div>
      )}

      <div className="card p-6 space-y-5">
        <div>
          <label className="label-base">Template *</label>
          <select value={templateId} onChange={(e) => handleTemplateChange(e.target.value)} className="input-base">
            <option value="">Select a template…</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label-base">Vessel Name *</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-500 text-sm font-medium pointer-events-none">M.V.</span>
            <input type="text" value={vesselName} onChange={(e) => setVesselName(e.target.value)} className="input-base pl-12" placeholder="Atlantic Spirit" />
          </div>
        </div>

        {autoTitle && (
          <div className="rounded-lg bg-brand-50 border border-brand-200 px-4 py-3">
            <p className="text-xs font-medium text-brand-700 mb-0.5">Checklist name</p>
            <p className="text-sm text-brand-900 font-medium">{autoTitle}</p>
          </div>
        )}

        <div>
          <label className="label-base">Client</label>
          <select value={showNewClient ? '__new__' : clientId} onChange={(e) => handleClientChange(e.target.value)} className="input-base">
            <option value="">No client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            {online && <option value="__new__">+ Request new client…</option>}
          </select>
          {showNewClient && (
            <div className="mt-2">
              <input type="text" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} className="input-base" placeholder="Enter new client name…" />
              <p className="text-xs text-amber-600 mt-1">This will be submitted for admin approval.</p>
            </div>
          )}
        </div>

        <div>
          <label className="label-base">Surveyor</label>
          <div className="input-base bg-gray-50 text-gray-700 flex items-center">{myName || 'Your account'}</div>
          <p className="text-xs text-gray-400 mt-1">This job is created under your account.</p>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}
      </div>

      <div className="flex justify-end gap-3">
        <Link href="/surveyor" className="btn-secondary">Cancel</Link>
        <button onClick={handleCreate} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Starting…' : 'Start Checklist'}
        </button>
      </div>
    </div>
  )
}
