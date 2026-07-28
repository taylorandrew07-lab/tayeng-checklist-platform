'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2 } from 'lucide-react'

const ROLE_HOME: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
  office: '/office',
}

// Resolve the destination from the session, then go straight into the user's app.
// Only genuinely-unauthenticated visitors ever see /login, so a launch never flashes
// the login card at an authenticated user.
//
// This must NOT be a Server Component. It previously called supabase.auth.getUser()
// server-side; a Server Component cannot write cookies, so whenever that call
// refreshed an expired access token the rotated refresh token was silently thrown
// away. The browser kept the OLD token, and its next refresh tripped Supabase's
// reuse detection (rotation is on, 10s reuse interval) and revoked the whole
// session — an intermittent "it logged me out again" that fired on every launch,
// because the PWA's start_url is "/". src/proxy.ts already dropped getUser() for
// exactly this reason; this page was the remaining offender.
//
// Doing it in the browser lets the Supabase client persist rotated tokens normally
// and serialise refreshes via its Web Lock.
export default function HomePage() {
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function route() {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (!session) { window.location.replace('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single()
      if (cancelled) return

      // Unknown/unreadable role falls back to the surveyor home, which the dashboard
      // layout re-routes if that turns out to be wrong. Never bounce to /login here:
      // the session is valid, and /login would send an authenticated user straight
      // back — a redirect loop.
      window.location.replace(ROLE_HOME[profile?.role ?? ''] ?? '/surveyor')
    }

    route().catch(() => { window.location.replace('/login') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-brand-900">
      <Loader2 className="h-8 w-8 animate-spin text-white/70" />
      <p className="text-sm text-white/70">Opening&hellip;</p>
    </div>
  )
}
