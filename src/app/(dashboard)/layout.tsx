'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import type { Profile } from '@/lib/types/database'

const ROLE_HOME: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
}

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
      if (!session) { router.push('/login'); return }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (!data) { router.push('/login'); return }
      setProfile(data)

      // Role-based path guard: redirect users who landed on the wrong dashboard
      const expectedPrefix = ROLE_HOME[data.role]
      if (expectedPrefix && !pathname.startsWith(expectedPrefix)) {
        router.replace(expectedPrefix)
        return
      }

      // Load pending user count for admin
      if (data.role === 'admin') {
        const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('is_active', false)
        setPendingCount(count ?? 0)
      }

      setLoading(false)
    }
    loadProfile()
  }, [router, pathname])

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
