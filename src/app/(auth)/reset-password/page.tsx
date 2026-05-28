'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Eye, EyeOff } from 'lucide-react'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Supabase puts the session in the URL hash after a password reset link click
    const supabase = createClient()
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    // Also handle hash-based session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }

    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: err } = await supabase.auth.updateUser({ password })

    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }

    window.location.href = '/admin'
  }

  if (!ready) {
    return (
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Verifying reset link…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-md">
      <div className="text-center mb-8">
        <img src="/logo-full.jpeg" alt="Taylor Engineering" className="h-20 w-auto mx-auto mb-4 rounded-xl" />
      </div>

      <div className="bg-white rounded-2xl shadow-2xl p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Set new password</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label-base">New password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-base pr-10"
                placeholder="Min. 8 characters"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600">
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="label-base">Confirm new password</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input-base"
              placeholder="Repeat password"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
