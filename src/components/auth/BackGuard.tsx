'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut, AlertTriangle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { dirtyState } from '@/lib/dirty-state'

// Role home routes — the "root" of each user's app. A back press here would leave
// the app, so we intercept it with a confirmation. Back between inner screens
// navigates normally (no guard is armed off the home routes).
const HOME_ROUTES = ['/admin', '/surveyor', '/client', '/office']

/**
 * Confirms before the phone/browser back button leaves the app at the stack root.
 * Pressing back from a role home shows "Log out of tayeng?"; Cancel stays put,
 * Log out signs out. Inner-screen back navigation is untouched.
 */
export default function BackGuard() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const atRoot = HOME_ROUTES.includes(pathname)

  useEffect(() => {
    if (!atRoot || typeof window === 'undefined') return
    // Seed a sentinel entry so the first back press at the root is captured here
    // instead of leaving the app.
    window.history.pushState({ teGuard: true }, '')
    const onPop = () => {
      // Re-arm so a subsequent back is captured too, then ask.
      window.history.pushState({ teGuard: true }, '')
      setOpen(true)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [atRoot, pathname])

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    dirtyState.set(false)
    dirtyState.setHandler(null)
    router.push('/login')
    router.refresh()
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Log out of Taylor Engineering?</h3>
            <p className="text-sm text-gray-500 mt-1">You pressed back at the home screen. Stay signed in, or log out?</p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={() => setOpen(false)} className="btn-secondary justify-center">Stay signed in</button>
          <button onClick={logout} className="btn-primary justify-center bg-red-600 hover:bg-red-500">
            <LogOut className="h-4 w-4" />Log out
          </button>
        </div>
      </div>
    </div>
  )
}
