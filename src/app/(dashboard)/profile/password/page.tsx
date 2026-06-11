'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowLeft, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react'

const MIN_LEN = 8

export default function ChangePasswordPage() {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < MIN_LEN) return setError(`New password must be at least ${MIN_LEN} characters.`)
    if (next !== confirm) return setError('The new passwords do not match.')
    if (next === current) return setError('The new password must be different from the current one.')

    setSaving(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user?.email) throw new Error('Your session has expired — please sign in again.')

      // Verify the current password by re-authenticating. Wrong password → stop.
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: current })
      if (verifyErr) { setError('Current password is incorrect.'); setSaving(false); return }

      const { error: updErr } = await supabase.auth.updateUser({ password: next })
      if (updErr) { setError(updErr.message); setSaving(false); return }

      setDone(true)
      setTimeout(() => router.push('/profile'), 1500)
    } catch (err: any) {
      setError(err?.message ?? 'Could not change your password.')
    } finally {
      setSaving(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto text-center py-16">
        <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
        <h1 className="page-title mb-1">Password changed</h1>
        <p className="text-gray-500">You&apos;re still signed in. Redirecting…</p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/profile" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="page-title">Change Password</h1>
          <p className="text-gray-500 mt-0.5">Update your account password.</p>
        </div>
      </div>

      <form onSubmit={submit} className="card p-6 space-y-5">
        {/* Hidden username field helps password managers associate the update. */}
        <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden readOnly value="" />

        <div>
          <label htmlFor="current" className="label-base">Current password</label>
          <input id="current" name="current-password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} className="input-base" />
        </div>
        <div>
          <label htmlFor="new" className="label-base">New password</label>
          <input id="new" name="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} className="input-base" />
          <p className="text-xs text-gray-400 mt-1">At least {MIN_LEN} characters.</p>
        </div>
        <div>
          <label htmlFor="confirm" className="label-base">Confirm new password</label>
          <input id="confirm" name="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="input-base" />
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} />
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} Show passwords
        </label>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

        <div className="flex justify-end gap-3">
          <Link href="/profile" className="btn-secondary">Cancel</Link>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Change password
          </button>
        </div>
      </form>
    </div>
  )
}
