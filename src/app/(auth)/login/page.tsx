'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { withTimeout } from '@/lib/utils'
import { signInErrorMessage, readAuthErrorFromUrl } from '@/lib/auth/errors'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import Image from 'next/image'
import logoFull from '../../../../public/logo-full.png'

const ROLE_REDIRECT: Record<string, string> = {
  admin: '/admin',
  surveyor: '/surveyor',
  client: '/client',
  office: '/office',
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Show errors passed via URL. Two channels: ?error=… from our own callback
  // redirect, and Supabase's #error_code=… fragment, which rides along when the
  // browser follows the redirect from an expired/!used email link. The fragment
  // never reaches the server, so this is the only place it can be surfaced.
  useEffect(() => {
    const urlError = readAuthErrorFromUrl(window.location.search, window.location.hash)
    if (urlError) {
      setError(urlError)
      // Strip the noise from the address bar so a refresh doesn't re-show it.
      window.history.replaceState(null, '', window.location.pathname)
    }
    // Prefill the last-used email (fallback for weak iOS standalone-PWA autofill).
    try { const last = localStorage.getItem('te_last_email'); if (last) setEmail(last) } catch { /* storage unavailable */ }

    // If already signed in (e.g. landed here via the phone back button), bounce
    // straight back into the app — the session is still valid, so /login should
    // never strand an authenticated user on the login screen.
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single()
      // No readable profile: do NOT bounce into the app. The dashboard would fail the
      // same lookup and send the user back here — an endless flicker between the two.
      // Stay put and explain it.
      if (!profile?.role) {
        await supabase.auth.signOut().catch(() => {})
        setError('Your sign-in worked but your account profile could not be loaded. Please contact your administrator.')
        return
      }
      window.location.href = ROLE_REDIRECT[profile.role] ?? '/surveyor'
    }).catch(() => { /* stay on login */ })
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    // Supabase stores addresses lower-cased, and an iOS keyboard readily adds a
    // trailing space (or a capital first letter) that turns a correct login into
    // "invalid credentials". The PASSWORD is never touched — trimming it would
    // silently break legitimately space-padded passwords.
    const cleanEmail = email.trim().toLowerCase()

    let authError
    try {
      ({ error: authError } = await withTimeout(
        supabase.auth.signInWithPassword({ email: cleanEmail, password }),
        15_000,
        'Signing in'
      ))
    } catch {
      setError('Sign-in timed out — check your connection and try again.')
      setLoading(false)
      return
    }

    if (authError) {
      // Report what actually went wrong. Collapsing rate limits, unconfirmed
      // accounts and network failures into "invalid password" made users retype a
      // password that was already correct.
      setError(signInErrorMessage(authError))
      setLoading(false)
      return
    }

    // Supabase persists the session in cookies (auto-refreshed) by default, which
    // keeps the user signed in across browser/app restarts on mobile and desktop —
    // this is what makes "Remember me" work.
    //
    // Remember-me preference drives a real, eviction-safe difference (see the
    // dashboard layout): unchecked enables a 30-minute inactivity auto-logout;
    // checked keeps the persisted session with no app-level timeout. We store the
    // preference as a simple flag and treat a MISSING flag as "remembered", so if
    // a mobile browser clears storage it can only relax the timeout — never wrongly
    // sign a user out. No passwords or tokens are stored here.
    // Guarded: sign-in has ALREADY succeeded by this point, so a storage failure
    // (iOS Private Browsing, blocked cookies) must not throw and strand the user on
    // a permanent "Signing in…" spinner.
    try {
      localStorage.setItem('te_remember', rememberMe ? '1' : '0')
      localStorage.setItem('te_last_activity', String(Date.now()))
      // Remember the email for prefill on the next visit (no password stored here).
      if (rememberMe) localStorage.setItem('te_last_email', cleanEmail)
      else localStorage.removeItem('te_last_email')
    } catch { /* storage unavailable */ }

    // Progressive enhancement: let Chrome/Android offer to save the credential even
    // where the submit heuristic is weak. Feature-detected; never blocks login.
    try {
      if (typeof window !== 'undefined' && 'PasswordCredential' in window && navigator.credentials?.store) {
        const cred = new (window as any).PasswordCredential({ id: email, password, name: email })
        await navigator.credentials.store(cred)
      }
    } catch { /* non-fatal */ }

    // Fetch profile to determine where to route the user. Sign-in already
    // succeeded, so if this lookup stalls we still send the user into the app
    // (the dashboard layout re-routes by role) rather than leaving a dead spinner.
    try {
      const { data: { user } } = await withTimeout(supabase.auth.getUser(), 10_000, 'Loading your account')
      const { data: profile } = await withTimeout(
        supabase.from('profiles').select('role, is_active').eq('id', user!.id).single(),
        10_000, 'Loading your account'
      )
      // Route to the role-appropriate dashboard.
      // Inactive users land on their dashboard where the layout shows the pending screen.
      window.location.href = ROLE_REDIRECT[profile?.role ?? ''] ?? '/surveyor'
    } catch {
      window.location.href = '/surveyor'
    }
  }

  return (
    <div className="w-full max-w-md">
      {/* Logo / Brand */}
      <div className="text-center mb-8 animate-rise">
        <Image src={logoFull} alt="Taylor Engineering Agencies Limited" className="w-full mx-auto mb-4 h-auto" unoptimized />
        <p className="text-brand-200 text-sm">Survey &amp; Job Management</p>
      </div>

      {/* Login Card */}
      <div className="bg-white rounded-2xl shadow-2xl p-8 animate-rise" style={{ animationDelay: '80ms' }}>
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="email" className="label-base">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-base"
              placeholder="you@tayeng.com"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="password" className="label-base mb-0">Password</label>
              <Link href="/forgot-password" className="text-xs text-brand-600 hover:text-brand-800">Forgot password?</Link>
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                enterKeyHint="go"
                // type="password" implies these, but the eye toggle flips the field
                // to type="text" — at which point iOS re-enables auto-capitalisation
                // and smart punctuation and can silently mangle what is typed.
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-base pr-10"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-gray-600">Stay signed in on this device</span>
            </label>
            <p className="text-xs text-gray-400 mt-1 ml-6">
              {rememberMe
                ? 'You’ll stay signed in when you reopen the app.'
                : 'You’ll be signed out automatically after 30 minutes of inactivity.'}
            </p>
            <p className="text-xs text-amber-600 mt-1 ml-6">
              Use only on your own device. Always sign out on shared devices.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 animate-rise">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full justify-center py-2.5"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in&hellip;
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-brand-600 hover:text-brand-800 font-medium">Request access</Link>
        </p>

        <p className="mt-3 text-center text-xs text-gray-400">
          Having trouble? Contact your administrator.
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-brand-300 animate-rise" style={{ animationDelay: '140ms' }}>
        Taylor Engineering Agencies Limited — Private Internal App
      </p>
    </div>
  )
}
