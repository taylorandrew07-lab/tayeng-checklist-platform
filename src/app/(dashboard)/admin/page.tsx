'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  FileText, Briefcase, Users, Building2, X, RefreshCw,
  SlidersHorizontal, ArrowUp, ArrowDown, Plus, Check, Clock,
} from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { WorkflowPill } from '@/components/job/StatusPill'
import AttentionCard, { type AttentionItem } from '@/components/dashboard/AttentionCard'
import { useDocumentAttention } from '@/components/dashboard/useDocumentAttention'
import { useReconciliationAttention } from '@/components/dashboard/useReconciliationAttention'
import type { UiPrefs } from '@/lib/types/database'

// Most urgent first when the attention sources are merged.
const TONE_RANK: Record<AttentionItem['tone'], number> = { danger: 0, warn: 1, info: 2 }

const CLEARED_AT_KEY = 'recentChecklistsClearedAt'

// ── Dashboard tile catalog ────────────────────────────────────────────────
// Action/nav tiles only — analytic counts (pipeline, template breakdowns) live
// on Insights so the Dashboard doesn't echo it.
type TileKey =
  | 'activeTemplates' | 'totalJobs' | 'users' | 'clients' | 'pendingApprovals'

interface TileDef { label: string; sub?: string; href?: string; icon: typeof FileText; color: string }

const TILE_DEFS: Record<TileKey, TileDef> = {
  activeTemplates:   { label: 'Templates',         sub: 'active', href: '/admin/templates', icon: FileText,  color: 'bg-blue-500' },
  totalJobs:         { label: 'Jobs',              sub: 'total',  href: '/admin/jobs',      icon: Briefcase, color: 'bg-indigo-500' },
  users:             { label: 'Users',             href: '/admin/users',   icon: Users,     color: 'bg-purple-500' },
  clients:           { label: 'Clients',           href: '/admin/clients', icon: Building2,  color: 'bg-pink-500' },
  pendingApprovals:  { label: 'Pending approvals', href: '/admin/users',   icon: Clock,     color: 'bg-yellow-500' },
}
const ALL_TILE_KEYS = Object.keys(TILE_DEFS) as TileKey[]
const DEFAULT_TILES: TileKey[] = ['activeTemplates', 'totalJobs', 'users', 'clients']

/** A single metric tile. Module-level so it isn't re-created each render. */
function StatTile({ def, value, loading }: { def: TileDef; value: number; loading: boolean }) {
  const inner = (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-500">{def.label}</p>
        {loading
          ? <div className="skeleton h-8 w-14 mt-1.5" />
          : <p className="text-3xl font-bold text-gray-900 mt-1 tnum">{value}</p>}
        {def.sub && <p className="text-xs text-gray-400 mt-0.5">{def.sub}</p>}
      </div>
      <div className={`w-12 h-12 rounded-xl ${def.color} flex items-center justify-center`}>
        <def.icon className="h-6 w-6 text-white" />
      </div>
    </div>
  )
  return def.href
    ? <Link href={def.href} className="card p-5 transition-[transform,box-shadow] duration-200 hover:shadow-md hover:-translate-y-0.5">{inner}</Link>
    : <div className="card p-5">{inner}</div>
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    activeTemplates: 0, checklists: 0,
    users: 0, clients: 0,
    pendingUsers: 0, pendingClients: 0, pendingChanges: 0,
  })
  const [recentChecklists, setRecentChecklists] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [clearedAt, setClearedAt] = useState<string | null>(null)
  // "Needs your attention" sources, merged into one prioritised queue:
  // billing/work exceptions (jobs done but not invoiced/closed) + expiring or
  // expired surveyor documents (admin-wide; both RLS-gated).
  const docAttention = useDocumentAttention({ context: 'admin' })
  const reconAttention = useReconciliationAttention()
  const attention = [...reconAttention, ...docAttention].sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone])

  // Customizable tiles, persisted to profiles.ui_prefs.dashboard_tiles.
  const [userId, setUserId] = useState<string | null>(null)
  const [uiPrefs, setUiPrefs] = useState<UiPrefs | null>(null)
  const [tiles, setTiles] = useState<TileKey[]>(DEFAULT_TILES)
  const [editMode, setEditMode] = useState(false)
  const [savingTiles, setSavingTiles] = useState(false)

  useEffect(() => {
    setClearedAt(localStorage.getItem(CLEARED_AT_KEY))
    loadData()
  }, [])

  async function loadData() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const [
      { data: templates },
      { count: jobCount },
      { count: userCount },
      { count: clientCount },
      { count: pendingUserCount },
      { count: pendingClientCount },
      { count: pendingChangeCount },
      { data: jobs },
      profileRes,
    ] = await Promise.all([
      supabase.from('checklist_templates').select('status'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('clients').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
      supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('jobs').select(`
        id, title, job_number, status, workflow_status, created_at, vessel_name, surveyor_name,
        template:checklist_templates(name),
        client:clients(name)
      `).order('created_at', { ascending: false }).limit(20),
      user ? supabase.from('profiles').select('ui_prefs').eq('id', user.id).single() : Promise.resolve({ data: null }),
    ])

    const tmpl = templates ?? []
    setStats({
      activeTemplates: tmpl.filter(t => t.status === 'active').length,
      checklists: jobCount ?? 0,
      users: userCount ?? 0,
      clients: clientCount ?? 0,
      pendingUsers: pendingUserCount ?? 0,
      pendingClients: pendingClientCount ?? 0,
      pendingChanges: pendingChangeCount ?? 0,
    })
    setRecentChecklists(jobs ?? [])

    if (user) {
      setUserId(user.id)
      const prefs = (profileRes?.data as { ui_prefs?: UiPrefs } | null)?.ui_prefs ?? null
      setUiPrefs(prefs)
      const saved = prefs?.dashboard_tiles?.filter((k): k is TileKey => (ALL_TILE_KEYS as string[]).includes(k))
      if (saved && saved.length) setTiles(saved)
    }
    setLoading(false)
  }

  function handleClear() {
    const now = new Date().toISOString()
    localStorage.setItem(CLEARED_AT_KEY, now)
    setClearedAt(now)
  }
  function handleUnclear() {
    localStorage.removeItem(CLEARED_AT_KEY)
    setClearedAt(null)
  }

  // ── Tile customization ──────────────────────────────────────────────────
  function toggleTile(key: TileKey) {
    setTiles(t => t.includes(key) ? t.filter(k => k !== key) : [...t, key])
  }
  function moveTile(idx: number, dir: -1 | 1) {
    setTiles(t => {
      const a = [...t]; const j = idx + dir
      if (j < 0 || j >= a.length) return a
      ;[a[idx], a[j]] = [a[j], a[idx]]
      return a
    })
  }
  async function saveTiles() {
    if (!userId) { setEditMode(false); return }
    setSavingTiles(true)
    const ui_prefs = { ...(uiPrefs ?? {}), dashboard_tiles: tiles }
    const { error } = await createClient().from('profiles').update({ ui_prefs }).eq('id', userId)
    setSavingTiles(false)
    if (!error) { setUiPrefs(ui_prefs); setEditMode(false) }
  }
  function cancelEdit() {
    const saved = uiPrefs?.dashboard_tiles?.filter((k): k is TileKey => (ALL_TILE_KEYS as string[]).includes(k))
    setTiles(saved && saved.length ? saved : DEFAULT_TILES)
    setEditMode(false)
  }

  const visibleChecklists = clearedAt
    ? recentChecklists.filter(j => j.created_at > clearedAt).slice(0, 6)
    : recentChecklists.slice(0, 6)
  const totalPending = stats.pendingUsers + stats.pendingClients + stats.pendingChanges

  const tileValue = (k: TileKey): number => {
    switch (k) {
      case 'activeTemplates': return stats.activeTemplates
      case 'totalJobs': return stats.checklists
      case 'users': return stats.users
      case 'clients': return stats.clients
      case 'pendingApprovals': return totalPending
    }
  }
  const available = ALL_TILE_KEYS.filter(k => !tiles.includes(k))

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-rise">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">What needs you today · <Link href="/admin/analytics" className="text-brand-600 hover:underline">View analytics</Link></p>
        </div>
        {!editMode ? (
          <button onClick={() => setEditMode(true)} className="btn-secondary text-sm flex-shrink-0">
            <SlidersHorizontal className="h-4 w-4" />Customize
          </button>
        ) : (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={cancelEdit} className="btn-secondary text-sm">Cancel</button>
            <button onClick={saveTiles} disabled={savingTiles} className="btn-primary text-sm">
              <Check className="h-4 w-4" />{savingTiles ? 'Saving…' : 'Done'}
            </button>
          </div>
        )}
      </div>

      {/* Pending approvals banner */}
      {totalPending > 0 && (
        <div className="rounded-xl bg-yellow-50 border border-yellow-200 px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse flex-shrink-0" />
            <div className="text-sm text-yellow-800">
              <span className="font-semibold">{totalPending} pending approval{totalPending > 1 ? 's' : ''}</span>
              {stats.pendingUsers > 0 && <span className="ml-2 text-yellow-700">{stats.pendingUsers} user{stats.pendingUsers > 1 ? 's' : ''}</span>}
              {stats.pendingClients > 0 && <span className="ml-2 text-yellow-700">{stats.pendingClients} new client{stats.pendingClients > 1 ? 's' : ''}</span>}
              {stats.pendingChanges > 0 && <span className="ml-2 text-yellow-700">{stats.pendingChanges} profile change{stats.pendingChanges > 1 ? 's' : ''}</span>}
            </div>
          </div>
          <Link href={(stats.pendingUsers + stats.pendingClients) > 0 ? '/admin/users' : '/admin/profile-requests'} className="text-xs font-medium text-yellow-800 hover:text-yellow-900 border border-yellow-300 px-3 py-1.5 rounded-lg hover:bg-yellow-100 transition-colors flex-shrink-0">
            Review →
          </Link>
        </div>
      )}

      {/* Needs your attention — billing/work exceptions + expiring documents */}
      <AttentionCard items={attention} />

      {/* Customize panel */}
      {editMode && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="section-title">Customize your tiles</h2>
            <p className="text-xs text-gray-400 mt-0.5">Choose which metrics appear and the order they show in. Saved to your account.</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Shown on your dashboard</p>
            {tiles.length === 0 ? (
              <p className="text-sm text-gray-400">No tiles selected — add some below.</p>
            ) : (
              <div className="space-y-1.5">
                {tiles.map((k, i) => (
                  <div key={k} className="flex items-center gap-2 p-2 rounded-lg border border-gray-200 bg-gray-50">
                    <span className="flex-1 text-sm font-medium text-gray-800">{TILE_DEFS[k].label}{TILE_DEFS[k].sub ? ` (${TILE_DEFS[k].sub})` : ''}</span>
                    <button onClick={() => moveTile(i, -1)} disabled={i === 0} className="btn-ghost p-1 disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-4 w-4" /></button>
                    <button onClick={() => moveTile(i, 1)} disabled={i === tiles.length - 1} className="btn-ghost p-1 disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-4 w-4" /></button>
                    <button onClick={() => toggleTile(k)} className="btn-ghost p-1 text-red-600 hover:bg-red-50" aria-label="Remove"><X className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {available.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Available to add</p>
              <div className="flex flex-wrap gap-2">
                {available.map(k => (
                  <button key={k} onClick={() => toggleTile(k)} className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
                    <Plus className="h-3.5 w-3.5 text-brand-600" />{TILE_DEFS[k].label}{TILE_DEFS[k].sub ? ` (${TILE_DEFS[k].sub})` : ''}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tile grid */}
      {tiles.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map(k => <StatTile key={k} def={TILE_DEFS[k]} value={tileValue(k)} loading={loading} />)}
        </div>
      )}

      {/* Recent Checklists */}
      <div className="card">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="section-title">Recent Jobs</h2>
          <div className="flex items-center gap-2">
            {clearedAt && (
              <button onClick={handleUnclear} className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-800 font-medium" title="Show all recent checklists">
                <RefreshCw className="h-3.5 w-3.5" />Restore
              </button>
            )}
            {visibleChecklists.length > 0 && (
              <button onClick={handleClear} className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 font-medium" title="Clear recent checklists from dashboard (does not delete records)">
                <X className="h-3.5 w-3.5" />Clear
              </button>
            )}
            <Link href="/admin/jobs" className="text-sm text-brand-600 hover:text-brand-800 font-medium">View all →</Link>
          </div>
        </div>
        {loading ? (
          <div className="divide-y divide-gray-100">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-4 w-1/3" />
                  <div className="skeleton h-3 w-1/2" />
                </div>
                <div className="skeleton h-5 w-16 rounded-full" />
              </div>
            ))}
          </div>
        ) : visibleChecklists.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="text-gray-400 text-sm">No recent checklists to display.</p>
            <Link href="/admin/jobs/new" className="mt-2 inline-block text-brand-600 hover:text-brand-800 text-sm font-medium">
              Create your first checklist →
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {visibleChecklists.map((job) => (
              <Link key={job.id} href={`/admin/jobs/${job.id}`} className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{job.title}</p>
                    <span className="text-xs text-gray-400 flex-shrink-0">{job.job_number}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    {job.client?.name ?? 'No client'} · {job.surveyor_name ?? 'No surveyor'} · {job.template?.name}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <WorkflowPill status={job.workflow_status} />
                  <span className="text-xs text-gray-400">{formatDate(job.created_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'New Template', href: '/admin/templates/new', icon: FileText },
          { label: 'New Job', href: '/admin/jobs/new', icon: Briefcase },
          { label: 'Add User', href: '/admin/users', icon: Users },
          { label: 'Add Client', href: '/admin/clients', icon: Building2 },
        ].map((action) => (
          <Link key={action.label} href={action.href} className="btn-secondary justify-center py-3 flex-col gap-1 h-auto">
            <action.icon className="h-5 w-5" />
            <span>{action.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
