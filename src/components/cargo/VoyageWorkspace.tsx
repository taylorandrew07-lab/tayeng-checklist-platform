'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Settings, Table, Images, FileDown, LineChart, CheckCircle2, CircleDot, RefreshCw, Cloud, CloudOff, ClipboardList, Anchor, Navigation, PackageOpen, FileText, ChevronRight } from 'lucide-react'
import { type Voyage } from '@/lib/cargo/types'
import { ensureDri, type DriReport } from '@/lib/cargo/dri'
import { getVoyage, putVoyage, getPhotosForVoyage, countPhotosForVoyage } from '@/lib/cargo/db'
import { currentUserId } from '@/lib/cargo/user'
import { createClient } from '@/lib/supabase/client'
import { syncVoyage, voyageDirty } from '@/lib/cargo/sync'
import VoyageSetupForm from '@/components/cargo/VoyageSetupForm'
import ReadingTypeManager from '@/components/cargo/ReadingTypeManager'
import ReadingsGrid from '@/components/cargo/ReadingsGrid'
import PhotoManager from '@/components/cargo/PhotoManager'
import ChartsPanel from '@/components/cargo/ChartsPanel'
import ReportBuilder from '@/components/cargo/ReportBuilder'
import { PrepTab, LoadingTab, VoyageLogTab, DischargeTab } from '@/components/cargo/DriWizard'
import DriReportBuilder from '@/components/cargo/DriReportBuilder'

type Tab = 'setup' | 'prep' | 'loading' | 'voyage' | 'discharge' | 'readings' | 'photos' | 'charts' | 'report' | 'dri_report'
const TABS: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
  { id: 'setup', label: 'Setup', icon: Settings },
  { id: 'prep', label: 'Prep', icon: ClipboardList },
  { id: 'loading', label: 'Loading', icon: Anchor },
  { id: 'voyage', label: 'Voyage', icon: Navigation },
  { id: 'discharge', label: 'Discharge', icon: PackageOpen },
  { id: 'readings', label: 'Readings', icon: Table },
  { id: 'photos', label: 'Photos', icon: Images },
  { id: 'charts', label: 'Charts', icon: LineChart },
  { id: 'report', label: 'Sensor PDF', icon: FileDown },
  { id: 'dri_report', label: 'DRI Report', icon: FileText },
]

// The 10 tabs grouped into 3 stages (+ Setup). Voyage Workflow renders as a
// stepper; Monitoring and Reports render as sub-tabs.
type Group = 'setup' | 'workflow' | 'monitoring' | 'reports'
const GROUPS: { id: Group; label: string; icon: React.ElementType; tabs: Tab[] }[] = [
  { id: 'setup',      label: 'Setup',           icon: Settings,   tabs: ['setup'] },
  { id: 'workflow',   label: 'Voyage Workflow', icon: Navigation, tabs: ['prep', 'loading', 'voyage', 'discharge'] },
  { id: 'monitoring', label: 'Monitoring',      icon: Table,      tabs: ['readings', 'photos', 'charts'] },
  { id: 'reports',    label: 'Reports',         icon: FileDown,   tabs: ['report', 'dri_report'] },
]
const tabMeta = (id: Tab) => TABS.find(t => t.id === id)!

/** Cargo voyage workspace. Works under both /surveyor/cargo and /admin/cargo. */
export default function VoyageWorkspace() {
  const params = useParams<{ id: string }>()
  const id = params.id
  const pathname = usePathname()
  const base = pathname.startsWith('/admin') ? '/admin/cargo' : '/surveyor/cargo'

  const [voyage, setVoyage] = useState<Voyage | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tab, setTab] = useState<Tab>('setup')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [photoCount, setPhotoCount] = useState<number | undefined>(undefined)

  const latest = useRef<Voyage | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let active = true
    async function load() {
      const uid = await currentUserId()
      if (!active) return
      if (!uid) { setNotFound(true); setLoading(false); return }
      const v = await getVoyage(uid, id)
      if (!active) return
      if (!v) { setNotFound(true); setLoading(false); return }
      setVoyage(v)
      latest.current = v
      setLoading(false)
      countPhotosForVoyage(id).then(n => { if (active) setPhotoCount(n) }).catch(() => {})
    }
    load()
    return () => {
      active = false
      saveNow() // flush any pending change on unmount so nothing is lost
    }
  }, [id])

  // Flush the latest pending change immediately (cancels the debounce). Safe to
  // call repeatedly; only uses refs so it never goes stale.
  function saveNow() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (latest.current) void putVoyage(latest.current)
  }

  // Also flush when the tab is hidden or the page is being torn down — a browser
  // kill or mobile app-switch can happen inside the debounce window otherwise.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') saveNow() }
    window.addEventListener('pagehide', saveNow)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', saveNow)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  async function syncNow() {
    saveNow()
    setSyncing(true)
    setSyncMsg(null)
    try {
      const uid = await currentUserId()
      if (!uid) throw new Error('You appear to be signed out.')
      await syncVoyage(createClient(), uid, id)
      const fresh = await getVoyage(uid, id)
      if (fresh) { setVoyage(fresh); latest.current = fresh }
      setSyncMsg({ ok: true, text: 'Synced to cloud.' })
    } catch (err: any) {
      setSyncMsg({ ok: false, text: err?.message ?? 'Sync failed — try again when online.' })
    } finally {
      setSyncing(false)
    }
  }

  async function toggleFinalise() {
    if (!voyage) return
    const next = { ...voyage, status: (voyage.status === 'finalized' ? 'in_progress' : 'finalized') as Voyage['status'] }
    update(next)
    // Push immediately so the client sees the new state without waiting for bg sync.
    setSyncing(true)
    setSyncMsg(null)
    try {
      const uid = await currentUserId()
      if (uid) { saveNow(); await syncVoyage(createClient(), uid, id); const fresh = await getVoyage(uid, id); if (fresh) { setVoyage(fresh); latest.current = fresh } }
      setSyncMsg({ ok: true, text: next.status === 'finalized' ? 'Finalised and synced.' : 'Reopened and synced.' })
    } catch (err: any) {
      setSyncMsg({ ok: false, text: 'Saved locally, but cloud sync failed — use Sync now when online.' })
    } finally {
      setSyncing(false)
    }
  }

  // Persist a change (debounced). State updates immediately; IndexedDB write follows.
  function update(next: Voyage) {
    setVoyage(next)
    latest.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      await putVoyage(next)
      setSavedAt(Date.now())
    }, 400)
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  }
  if (notFound || !voyage) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <h1 className="page-title mb-2">Voyage not found</h1>
        <p className="text-gray-500 mb-6">This voyage isn&apos;t stored on this device.</p>
        <Link href={base} className="btn-secondary">Back to Cargo</Link>
      </div>
    )
  }

  const activeGroupDef = GROUPS.find(g => g.tabs.includes(tab)) ?? GROUPS[0]

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-4">
        <Link href={base} className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0">
          <h1 className="page-title truncate">M.V. {voyage.vesselName} — {voyage.voyageNumber}</h1>
          <p className="text-gray-500 mt-0.5 text-sm">
            {voyage.cargoType || 'Cargo'} · {voyage.holdCount} holds
            {savedAt && <span className="text-green-600"> · saved</span>}
          </p>
        </div>
      </div>

      {/* Status + sync bar */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        {(() => {
          const finalized = voyage.status === 'finalized'
          const dirty = voyageDirty(voyage)
          return (
            <>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${finalized ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {finalized ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleDot className="h-3.5 w-3.5" />}
                {finalized ? 'Finalised' : 'In progress'}
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                {dirty ? <CloudOff className="h-3.5 w-3.5 text-amber-500" /> : <Cloud className="h-3.5 w-3.5 text-green-500" />}
                {dirty ? 'Changes not yet synced' : voyage.lastSyncedAt ? 'Synced to cloud' : 'Not synced yet'}
              </span>

              <div className="ml-auto flex items-center gap-2">
                <button onClick={syncNow} disabled={syncing} className="btn-secondary text-xs py-1.5 px-3">
                  {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {syncing ? 'Syncing…' : 'Sync now'}
                </button>
                <button
                  onClick={toggleFinalise}
                  disabled={syncing}
                  className={finalized ? 'btn-secondary text-xs py-1.5 px-3' : 'btn-primary text-xs py-1.5 px-3'}
                >
                  {finalized ? 'Mark as in progress' : 'Finalise report'}
                </button>
              </div>
            </>
          )
        })()}
        {syncMsg && (
          <p className={`w-full text-xs ${syncMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{syncMsg.text}</p>
        )}
      </div>

      {/* Primary group bar */}
      <div className="flex gap-0.5 border-b border-gray-200 overflow-x-auto">
        {GROUPS.map(g => {
          const isActive = g.tabs.includes(tab)
          return (
            <button
              key={g.id}
              onClick={() => setTab(g.tabs[0])}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap -mb-px rounded-t-md transition-colors ${
                isActive ? 'border-brand-600 text-brand-700 bg-brand-50/60' : 'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'
              }`}
            >
              <g.icon className="h-4 w-4" />{g.label}
            </button>
          )
        })}
      </div>

      {/* Sub-nav: a stepper for Voyage Workflow, sub-tabs for Monitoring/Reports */}
      {activeGroupDef.id === 'workflow' && (
        <div className="flex items-center overflow-x-auto pb-1">
          {activeGroupDef.tabs.map((t, i) => {
            const meta = tabMeta(t); const isActive = tab === t
            return (
              <div key={t} className="flex items-center">
                {i > 0 && <ChevronRight className="h-4 w-4 text-gray-300 mx-0.5 flex-shrink-0" />}
                <button
                  onClick={() => setTab(t)}
                  className={`flex items-center gap-2 text-sm pl-1.5 pr-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    isActive ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <span className={`flex items-center justify-center h-5 w-5 rounded-full text-[11px] font-semibold ${isActive ? 'bg-white/25 text-white' : 'bg-white text-gray-500'}`}>{i + 1}</span>
                  {meta.label}
                </button>
              </div>
            )
          })}
        </div>
      )}
      {(activeGroupDef.id === 'monitoring' || activeGroupDef.id === 'reports') && (
        <div className="flex gap-1 overflow-x-auto">
          {activeGroupDef.tabs.map(t => {
            const meta = tabMeta(t); const isActive = tab === t
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex items-center gap-2 text-sm px-3.5 py-2 rounded-lg whitespace-nowrap transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                <meta.icon className="h-4 w-4" />{meta.label}
              </button>
            )
          })}
        </div>
      )}

      {tab === 'setup' && (
        <div className="space-y-8">
          <VoyageSetupForm voyage={voyage} onSaved={update} submitLabel="Save Setup" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Reading Types</h2>
            {voyage.templateName && (
              <p className="text-sm text-gray-500 mb-2">From template: <span className="font-medium text-gray-700">{voyage.templateName}</span>. Edits here apply only to this voyage.</p>
            )}
            <ReadingTypeManager
              readingTypes={voyage.readingTypes}
              holdCount={voyage.holdCount}
              onChange={types => update({ ...voyage, readingTypes: types })}
            />
          </div>
        </div>
      )}
      {(tab === 'prep' || tab === 'loading' || tab === 'voyage' || tab === 'discharge') && (() => {
        const dri = ensureDri(voyage.dri, voyage.holdCount)
        const setDri = (d: DriReport) => update({ ...voyage, dri: d })
        const readOnly = voyage.status === 'finalized'
        if (tab === 'prep') return <PrepTab dri={dri} holdCount={voyage.holdCount} onChange={setDri} readOnly={readOnly} />
        if (tab === 'loading') return <LoadingTab dri={dri} defaultDate={voyage.startDate} onChange={setDri} readOnly={readOnly} />
        if (tab === 'voyage') return <VoyageLogTab dri={dri} startDate={voyage.startDate} endDate={voyage.endDate} onChange={setDri} readOnly={readOnly} />
        return <DischargeTab dri={dri} defaultDate={voyage.endDate} onChange={setDri} readOnly={readOnly} />
      })()}
      {tab === 'readings' && <ReadingsGrid voyage={voyage} onChange={update} />}
      {tab === 'photos' && <PhotoManager voyage={voyage} onChange={update} />}
      {tab === 'charts' && <ChartsPanel voyage={voyage} onChange={update} />}
      {tab === 'report' && <ReportBuilder voyage={voyage} onChange={update} />}
      {tab === 'dri_report' && (
        <DriReportBuilder
          voyage={voyage}
          onChange={update}
          photoCount={photoCount}
          loadPhotos={() => getPhotosForVoyage(voyage.userId, voyage.id)}
        />
      )}
    </div>
  )
}
