'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient, hasAuthCookie } from '@/lib/supabase/client'
import { Loader2, Pencil, KeyRound, Clock, X, ShieldCheck, WifiOff } from 'lucide-react'
import CredentialsManager from '@/components/personal-docs/CredentialsManager'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'

interface ProfileRow { id: string; full_name: string; email: string; phone: string | null; role: string; is_super_admin?: boolean; display_title?: string | null }
interface PendingReq { id: string; requested_changes: Record<string, any>; created_at: string }

type FieldName = 'full_name' | 'phone' | 'email'

/** Module-level so the inputs keep focus while typing (a component defined inside
 *  render would remount on every keystroke). */
function ProfileField({ label, name, value, type = 'text', editing, pendingValue, formValue, onFormChange }: {
  label: string; name: FieldName; value: string; type?: string; editing: boolean
  pendingValue: string | undefined; formValue: string; onFormChange: (v: string) => void
}) {
  const isPending = pendingValue !== undefined
  return (
    <div className="py-3 border-b border-gray-100">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium text-gray-500">{label}</label>
        {isPending && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
            <Clock className="h-3 w-3" />Pending approval
          </span>
        )}
      </div>
      {editing && !isPending ? (
        <input
          type={type} className="input-base mt-1"
          autoComplete={name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'name'}
          value={formValue} onChange={e => onFormChange(e.target.value)}
        />
      ) : (
        <p className="text-gray-900 mt-0.5">
          {value || <span className="text-gray-400">—</span>}
          {isPending && <span className="text-amber-600 text-sm"> → {pendingValue}</span>}
        </p>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [pending, setPending] = useState<PendingReq | null>(null)
  const [loading, setLoading] = useState(true)
  const [online, setOnline] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ full_name: '', phone: '', email: '' })

  async function load(attempt = 0) {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // Don't bounce to /login on a transient null session while the auth cookie
      // is still present (Android waking before the network is back). Retry to let
      // auto-refresh recover; only redirect when genuinely signed out.
      if (hasAuthCookie()) {
        if (attempt < 3) { setTimeout(() => load(attempt + 1), 600); return }
        setLoading(false); return
      }
      router.push('/login'); return
    }
    const { data: p } = await supabase.from('profiles').select('id, full_name, email, phone, role, is_super_admin, display_title').eq('id', session.user.id).single()
    if (p) {
      setProfile(p)
      setForm({ full_name: p.full_name ?? '', phone: p.phone ?? '', email: p.email ?? '' })
    }
    const { data: reqs } = await supabase
      .from('profile_change_requests')
      .select('id, requested_changes, created_at')
      .eq('user_id', session.user.id).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1)
    setPending(reqs?.[0] ?? null)
    setLoading(false)
  }

  useEffect(() => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
    const onStatus = () => setOnline(navigator.onLine)
    window.addEventListener('online', onStatus); window.addEventListener('offline', onStatus)
    load()
    return () => { window.removeEventListener('online', onStatus); window.removeEventListener('offline', onStatus) }
  }, [])

  async function submit() {
    if (!profile) return
    const changes: Record<string, string> = {}
    if (form.full_name.trim() && form.full_name.trim() !== profile.full_name) changes.full_name = form.full_name.trim()
    if ((form.phone ?? '').trim() !== (profile.phone ?? '')) changes.phone = form.phone.trim()
    if (form.email.trim() && form.email.trim() !== profile.email) changes.email = form.email.trim()
    if (Object.keys(changes).length === 0) { setError('No changes to submit.'); return }

    setSaving(true); setError(null)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('profile_change_requests').insert({
        user_id: profile.id,
        requested_changes: changes,
        current_values: { full_name: profile.full_name, phone: profile.phone, email: profile.email },
      })
      if (error) throw error
      setEditing(false)
      toast.success('Change request submitted for approval')
      await load()
    } catch (err: any) {
      setError(err?.message ?? 'Could not submit your request.')
    } finally {
      setSaving(false)
    }
  }

  async function cancelPending() {
    if (!pending) return
    if (!(await confirmDialog({ message: 'Cancel your pending change request?', confirmLabel: 'Cancel request' }))) return
    const supabase = createClient()
    await supabase.from('profile_change_requests').delete().eq('id', pending.id)
    toast.success('Request cancelled')
    await load()
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!profile) return null

  const isAdmin = profile.role === 'admin' || profile.is_super_admin
  const pv = (name: FieldName): string | undefined =>
    name in (pending?.requested_changes ?? {}) ? String(pending?.requested_changes[name]) : undefined

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="text-gray-500 mt-0.5">View your details and manage your account.</p>
        </div>
        {isAdmin && (
          <Link href="/admin/profile-requests" className="btn-secondary text-sm"><ShieldCheck className="h-4 w-4" />Approvals</Link>
        )}
      </div>

      {!online && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center gap-2">
          <WifiOff className="h-4 w-4 flex-shrink-0" />You&apos;re offline — profile changes are unavailable until you reconnect.
        </div>
      )}

      {pending && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800 flex items-center justify-between gap-2">
          <span>You have a change request awaiting administrator approval.</span>
          <button onClick={cancelPending} className="inline-flex items-center gap-1 font-medium hover:underline"><X className="h-3.5 w-3.5" />Cancel</button>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="section-title">Details</h2>
          {!editing && !pending && online && (
            <button onClick={() => setEditing(true)} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />Edit details</button>
          )}
        </div>

        <ProfileField label="Full name" name="full_name" value={profile.full_name} editing={editing} pendingValue={pv('full_name')} formValue={form.full_name} onFormChange={v => setForm(f => ({ ...f, full_name: v }))} />
        <ProfileField label="Email" name="email" type="email" value={profile.email} editing={editing} pendingValue={pv('email')} formValue={form.email} onFormChange={v => setForm(f => ({ ...f, email: v }))} />
        <ProfileField label="Phone" name="phone" type="tel" value={profile.phone ?? ''} editing={editing} pendingValue={pv('phone')} formValue={form.phone} onFormChange={v => setForm(f => ({ ...f, phone: v }))} />
        <div className="py-3 border-b border-gray-100">
          <label className="text-sm font-medium text-gray-500">Role</label>
          <p className="text-gray-900 mt-0.5 capitalize">{profile.is_super_admin ? 'Super Admin' : (profile.display_title ?? profile.role)}</p>
        </div>
        <div className="py-3 flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-gray-500">Password</label>
            <p className="text-gray-900 mt-0.5 tracking-widest">••••••••</p>
          </div>
          <Link href="/profile/password" className="btn-secondary text-sm"><KeyRound className="h-4 w-4" />Change password</Link>
        </div>

        {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 mt-3">{error}</div>}

        {editing && (
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => { setEditing(false); setError(null); setForm({ full_name: profile.full_name, phone: profile.phone ?? '', email: profile.email }) }} className="btn-secondary">Cancel</button>
            <button onClick={submit} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Submit for approval
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400">Changes to your name, email or phone require administrator approval. Your password is changed instantly and never requires approval.</p>

      {(profile.role === 'surveyor' || profile.role === 'admin' || profile.is_super_admin) && (
        <div className="card p-6">
          <h2 className="section-title mb-1">Credentials &amp; documents</h2>
          <p className="text-xs text-gray-400 mb-4">Your permit, ID, passport, insurance, CoC and other documents — used by the office to produce port passes. Fill the details and/or upload the file in one place; add an expiry date and you&apos;ll be reminded before it lapses. No approval needed.</p>
          <CredentialsManager profileId={profile.id} canManage />
        </div>
      )}
    </div>
  )
}
