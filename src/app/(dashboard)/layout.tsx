'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient, hasAuthCookie } from '@/lib/supabase/client'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import ServiceWorkerRegister from '@/components/offline/ServiceWorkerRegister'
import OfflineSyncManager from '@/components/offline/OfflineSyncManager'
import CargoSyncManager from '@/components/cargo/CargoSyncManager'
import BackGuard from '@/components/auth/BackGuard'
import { fetchMyOfficePermissions } from '@/lib/office/permissions'
import { useRealtimeRefresh } from '@/lib/realtime'
import { unreadCount } from '@/lib/messages/api'
import { listReconciliation } from '@/lib/jobs/reconciliation'
import { CLIENT_PORTAL_ENABLED } from '@/lib/features'
import type { Profile } from '@/lib/types/database'

const ROLE_HOME: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
  office: '/office',
}

// Inactivity auto-logout window applied only when the user did NOT choose to stay
// signed in. Long enough that normal mobile app-switching never triggers it.
const IDLE_LIMIT_MS = 30 * 60 * 1000

// Last-known profile, cached at line ~77 on every successful load. Read only in an
// effect (never in a useState initializer) to avoid a client/server hydration
// mismatch. Used to paint the staff shell immediately instead of blocking on the
// profiles fetch — the same cache the offline fallback already trusts.
function cachedStaffProfile(): Profile | null {
  if (typeof window === 'undefined') return null
  const path = window.location.pathname
  if (!path.startsWith('/surveyor') && !path.startsWith('/admin')) return null
  try {
    const raw = localStorage.getItem('te_profile')
    return raw ? (JSON.parse(raw) as Profile) : null
  } catch {
    return null
  }
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [reconcileCount, setReconcileCount] = useState(0)
  const [officePermissions, setOfficePermissions] = useState<string[]>([])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()
  const msgTick = useRealtimeRefresh('message_recipients')

  // Load profile + nav badges ONCE per session — NOT on every navigation. (This
  // used to re-run on every pathname change, re-scanning jobs+invoices for the
  // reconcile badge on each page load.)
  useEffect(() => {
    // Paint the staff shell immediately from the cached profile (no network wait),
    // then verify the session and refresh below. loadProfile still redirects to
    // /login if the session is genuinely gone, so this only skips the blank spinner.
    const cached = cachedStaffProfile()
    if (cached) { setProfile(cached); setLoading(false) }

    async function loadProfile(attempt = 0) {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      // Supabase persists the session itself (cookie storage, auto-refreshed).
      if (!session) {
        // No session object — but if the long-lived auth cookie is still present,
        // this is almost always transient: Android wakes the PWA before the network
        // radio is back, so the expired access token can't refresh yet and
        // getSession() momentarily returns null. Bouncing to /login here was a top
        // cause of the "it logged me out" complaint. Instead: retry a few times to
        // give auto-refresh a chance, and never redirect while the cookie is intact
        // (RLS still guards every row, and the cached staff shell stays painted).
        if (hasAuthCookie()) {
          if (attempt < 3) { setTimeout(() => loadProfile(attempt + 1), 600); return }
          setLoading(false); return
        }
        // Genuinely signed out (no cookie) — go to login.
        router.push('/login'); return
      }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!data) {
        // Offline fallback: reuse the last cached profile so a previously-loaded
        // checklist can reopen without connectivity.
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          const cached = localStorage.getItem('te_profile')
          if (cached) {
            try {
              const parsed = JSON.parse(cached)
              const path = typeof window !== 'undefined' ? window.location.pathname : ''
              const staffPath = path.startsWith('/surveyor') || path.startsWith('/admin')
              if (parsed?.id === session.user.id && staffPath) {
                setProfile(parsed); setLoading(false); return
              }
            } catch { /* fall through to login */ }
          }
        }
        router.push('/login'); return
      }
      try { localStorage.setItem('te_profile', JSON.stringify(data)) } catch { /* storage may be unavailable */ }
      setProfile(data)
      setLoading(false)

      // Nav badge counts (admin). Cheap head-count queries; reconcile is heavier
      // so it's fire-and-forget and only runs this once.
      if (data.role === 'admin') {
        const [u, c, p] = await Promise.all([
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false),
          supabase.from('client_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        ])
        setPendingCount((u.count ?? 0) + (c.count ?? 0) + (p.count ?? 0))
        listReconciliation().then(r => setReconcileCount(r.items.length)).catch(() => {})
      }
      if (data.role === 'office') {
        const granted = await fetchMyOfficePermissions(supabase)
        setOfficePermissions(Array.from(granted))
      }
    }
    loadProfile()
  }, [router])

  // Role-based path guard — runs on navigation (cheap; no fetches). Redirects a
  // user who lands on another role's area; shared routes are open to everyone.
  useEffect(() => {
    if (!profile) return
    const SHARED_ROUTES = ['/profile', '/inbox', '/calendar', '/personnel']
    const expectedPrefix = ROLE_HOME[profile.role]
    const isShared = SHARED_ROUTES.some(r => pathname.startsWith(r))
    if (expectedPrefix && !isShared && !pathname.startsWith(expectedPrefix)) {
      router.replace(expectedPrefix)
    }
  }, [profile, pathname, router])

  // Live unread-message count for the Inbox nav badge. Safe before migration 037
  // (unreadCount returns 0 on error).
  useEffect(() => {
    if (!profile) return
    unreadCount().then(setUnreadMessages).catch(() => {})
  }, [profile, msgTick])

  // Inactivity auto-logout — only when the user did NOT choose to stay signed in.
  // Eviction-safe: a missing "te_remember" flag is treated as "remembered" (no
  // timeout), and a missing "te_last_activity" skips the check, so clearing mobile
  // storage can never wrongly sign a user out — it only relaxes the timeout.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const remembered = localStorage.getItem('te_remember') !== '0'
    if (remembered) return // stay signed in; rely on Supabase persisted session

    const supabase = createClient()
    const mark = () => localStorage.setItem('te_last_activity', String(Date.now()))
    const checkIdle = async () => {
      const last = parseInt(localStorage.getItem('te_last_activity') ?? '', 10)
      if (!isNaN(last) && Date.now() - last > IDLE_LIMIT_MS) {
        await supabase.auth.signOut()
        window.location.href = '/login'
      }
    }

    // Check immediately (covers reopening the app after a long idle), then track activity
    checkIdle()
    const events = ['pointerdown', 'keydown', 'touchstart']
    events.forEach(e => window.addEventListener(e, mark, { passive: true }))
    const onVisible = () => { if (document.visibilityState === 'visible') checkIdle() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(checkIdle, 60_000)

    return () => {
      events.forEach(e => window.removeEventListener(e, mark))
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading&hellip;</p>
        </div>
      </div>
    )
  }

  // Pending approval — account exists but not yet approved by admin
  if (profile && !profile.is_active) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-yellow-100 flex items-center justify-center mx-auto">
            <svg className="h-7 w-7 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Account pending approval</h2>
          <p className="text-sm text-gray-500">
            Your account is waiting for administrator approval. You&apos;ll receive access once it&apos;s been reviewed.
          </p>
          <button
            onClick={async () => { const s = createClient(); await s.auth.signOut(); window.location.href = '/login' }}
            className="btn-secondary w-full justify-center"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (!profile) return null

  // Client portal disabled — a client account can authenticate but sees nothing.
  // Reversible: flip CLIENT_PORTAL_ENABLED in src/lib/features.ts.
  if (profile.role === 'client' && !CLIENT_PORTAL_ENABLED) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-brand-50 flex items-center justify-center mx-auto">
            <svg className="h-7 w-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Portal unavailable</h2>
          <p className="text-sm text-gray-500">
            The client portal isn&apos;t available right now. Please contact Taylor Engineering directly for your reports.
          </p>
          <button
            onClick={async () => { const s = createClient(); await s.auth.signOut(); window.location.href = '/login' }}
            className="btn-secondary w-full justify-center"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Offline support is staff-only. ServiceWorkerRegister unregisters itself
          for client accounts; OfflineSyncManager pushes pending drafts (e.g. an
          offline submit) once back online, independent of the checklist editor. */}
      <ServiceWorkerRegister enabled={profile.role === 'admin' || profile.role === 'surveyor'} />
      {(profile.role === 'admin' || profile.role === 'surveyor') && <OfflineSyncManager />}
      {(profile.role === 'admin' || profile.role === 'surveyor') && <CargoSyncManager />}
      <BackGuard />
      <Sidebar
        profile={profile}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pendingCount={pendingCount}
        unreadMessages={unreadMessages}
        reconcileCount={reconcileCount}
        officePermissions={officePermissions}
      />
      <div className="flex flex-col min-h-screen lg:pl-64">
        <Header profile={profile} onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
