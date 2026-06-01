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
    const redirectTo = `${window.location.origin}/reset-password`

    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    setSent(true)
    setLoading(false)
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <img src="/logo-full.jpeg" alt="Taylor Engineering" className="h-20 w-auto mx-auto mb-4 rounded-xl" />
      </div>

      <div className="bg-white rounded-2xl shadow-2xl p-8">
        <Link href="/login" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5">
          <ArrowLeft className="h-4 w-4" /> Back to sign in
        </Link>

        <h2 className="text-xl font-semibold text-gray-900 mb-2">Reset your password</h2>
        <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send you a reset link.</p>

        {sent ? (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-sm text-green-700">
            Reset link sent to <strong>{email}</strong>. Check your inbox.
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
