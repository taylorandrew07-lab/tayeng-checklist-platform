'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import ServiceWorkerRegister from '@/components/offline/ServiceWorkerRegister'
import type { Profile } from '@/lib/types/database'

const ROLE_HOME: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
}

// Inactivity auto-logout window applied only when the user did NOT choose to stay
// signed in. Long enough that normal mobile app-switching never triggers it.
const IDLE_LIMIT_MS = 30 * 60 * 1000

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      // Supabase persists the session itself (cookie storage, auto-refreshed).
      // Only redirect when there is genuinely no valid session — never force a
      // sign-out based on custom localStorage flags, which mobile browsers evict
      // and which was logging "Remember me" users out on every app open.
      if (!session) { router.push('/login'); return }

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
            try { setProfile(JSON.parse(cached)); setLoading(false); return } catch { /* fall through to login */ }
          }
        }
        router.push('/login'); return
      }
      try { localStorage.setItem('te_profile', JSON.stringify(data)) } catch { /* storage may be unavailable */ }
      setProfile(data)

      // Role-based path guard: redirect users who landed on the wrong dashboard
      const expectedPrefix = ROLE_HOME[data.role]
      if (expectedPrefix && !pathname.startsWith(expectedPrefix)) {
        router.replace(expectedPrefix)
        return
      }

      // Load pending user count for admin
      if (data.role === 'admin') {
        const { count } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', false)
        setPendingCount(count ?? 0)
      }

      setLoading(false)
    }
    loadProfile()
  }, [router, pathname])

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

  return (
    <div className="min-h-screen bg-gray-50">
      <ServiceWorkerRegister />
      <Sidebar
        profile={profile}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        pendingCount={pendingCount}
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
