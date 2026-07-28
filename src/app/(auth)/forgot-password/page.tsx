'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ArrowLeft } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    // Route through callback so the PKCE code is exchanged server-side,
    // then redirected to /reset-password with a live session.
    const redirectTo = `${window.location.origin}/api/auth/callback?next=/reset-password`

    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    // Always show a generic message — do not confirm whether the email exists.
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8 animate-rise">
        <img src="/logo-full.png" alt="Taylor Engineering" className="w-full mx-auto mb-4" />
      </div>

      <div className="bg-white rounded-2xl shadow-2xl p-8 animate-rise" style={{ animationDelay: '80ms' }}>
        <Link href="/login" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>

        <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset your password</h2>
        <p className="text-sm text-gray-500 mb-6">Enter your email and we&apos;ll send you a reset link.</p>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700">
              If an account exists for that email address, a reset link has been sent. Check your inbox.
            </div>
            {/* The reset code is tied to THIS browser (PKCE stores a verifier here).
                Tapping the link inside a mail app's built-in browser opens a different
                one, which fails — and burns the single-use link. */}
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800 space-y-2">
              <p className="font-medium">Open the link in this same browser.</p>
              <p>
                If tapping it from your email app doesn&apos;t work, press and hold the
                link, copy it, and paste it into this browser instead.
              </p>
              <p>
                No email after a few minutes? Ask an administrator to set a password for
                you directly — they don&apos;t need email to do it.
              </p>
            </div>
            <Link href="/login" className="btn-secondary w-full justify-center">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="fp-email" className="label-base">Email address</label>
              <input
                id="fp-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-base"
                placeholder="you@tayeng.com"
              />
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send reset link'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
