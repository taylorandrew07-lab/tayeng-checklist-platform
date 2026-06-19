'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { withTimeout } from '@/lib/utils'
import { Loader2, Eye, EyeOff, ArrowLeft } from 'lucide-react'

export default function SignUpPage() {
  const [form, setForm] = useState({ fullName: '', email: '', password: '', role: 'surveyor' })
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  function update(patch: Partial<typeof form>) { setForm(p => ({ ...p, ...patch })) }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError(null)

    const supabase = createClient()

    // Cargo Technician is a surveyor with a cosmetic job title — same role/permissions.
    const isCargoTech = form.role === 'super_cargo'
    const role = isCargoTech ? 'surveyor' : form.role
    const displayTitle = isCargoTech ? 'Cargo Technician' : null

    // Pass full_name, role and optional display_title in metadata so the
    // handle_new_user trigger can use them. The trigger always sets
    // is_active=false — no client-side profile upsert needed.
    let signUpErr
    try {
      ({ error: signUpErr } = await withTimeout(supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            full_name: form.fullName,
            role,
            display_title: displayTitle,
          },
        },
      }), 15_000, 'Creating your account'))
    } catch {
      setError('Sign-up timed out — check your connection and try again.')
      setLoading(false)
      return
    }

    if (signUpErr) {
      setError(signUpErr.message)
      setLoading(false)
      return
    }

    // Notify admin of the new request (fire-and-forget; errors don't block the user)
    fetch('/api/notify/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'signup', name: form.fullName, email: form.email, role: displayTitle ?? role }),
    }).catch(() => {})

    // Sign out immediately — account requires admin approval before access is granted.
    // Time-bounded so a stalled sign-out can't trap the user on a spinner after the
    // account was already created.
    await withTimeout(supabase.auth.signOut(), 8_000, 'Finishing up').catch(() => {})
    setDone(true)
    setLoading(false)
  }

  if (done) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-4 animate-rise">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <svg className="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Account request submitted</h2>
          <p className="text-sm text-gray-500">
            Your account is pending approval by an administrator. You&apos;ll be able to log in once it&apos;s approved.
          </p>
          <Link href="/login" className="btn-primary justify-center w-full">Back to Sign In</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8 animate-rise">
        <img src="/logo-full.png" alt="Taylor Engineering" className="w-full mx-auto mb-4" />
        <p className="text-brand-200 text-sm">Survey &amp; Job Management</p>
      </div>

      <div className="bg-white rounded-2xl shadow-2xl p-8 animate-rise" style={{ animationDelay: '80ms' }}>
        <Link href="/login" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>

        <h2 className="text-xl font-semibold text-gray-900 mb-6">Create an account</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="su-name" className="label-base">Full name</label>
            <input id="su-name" type="text" autoComplete="name" required value={form.fullName}
              onChange={(e) => update({ fullName: e.target.value })}
              className="input-base" placeholder="Your full name" />
          </div>

          <div>
            <label htmlFor="su-email" className="label-base">Email address</label>
            <input id="su-email" type="email" autoComplete="email" required value={form.email}
              onChange={(e) => update({ email: e.target.value })}
              className="input-base" placeholder="you@tayeng.com" />
          </div>

          <div>
            <label htmlFor="su-password" className="label-base">Password</label>
            <div className="relative">
              <input id="su-password" type={showPassword ? 'text' : 'password'}
                autoComplete="new-password" required value={form.password}
                onChange={(e) => update({ password: e.target.value })}
                className="input-base pr-10" placeholder="Min. 8 characters" />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label-base">I am a&hellip;</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
              {/* Office (and admin) accounts are created by an admin via
                  /api/admin/create-user, never self-signup — see migration 068. */}
              {[
                { value: 'surveyor', label: 'Surveyor', desc: 'Complete and submit survey jobs' },
                { value: 'super_cargo', label: 'Cargo Technician', desc: 'Same as surveyor (different title)' },
                { value: 'client', label: 'Client', desc: 'View job reports and results' },
              ].map(opt => (
                <label key={opt.value} className={`flex flex-col gap-1 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  form.role === opt.value ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input type="radio" name="role" value={opt.value} checked={form.role === opt.value}
                    onChange={() => update({ role: opt.value })} className="sr-only" />
                  <span className="text-sm font-medium text-gray-900">{opt.label}</span>
                  <span className="text-xs text-gray-500">{opt.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Request account'}
          </button>

          <p className="text-xs text-center text-gray-500">
            Your account requires administrator approval before you can log in.
          </p>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-brand-300">
        Taylor Engineering Agencies Limited — Private Internal App
      </p>
    </div>
  )
}
