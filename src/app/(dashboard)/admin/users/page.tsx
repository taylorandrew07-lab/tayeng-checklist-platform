'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Loader2, Check, X, Pencil, ShieldCheck, FileText, Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { confirmDialog } from '@/components/ui/confirm'
import PageHeader from '@/components/ui/PageHeader'
import { toast } from '@/components/ui/toast'
import PeopleTabs from '@/components/admin/PeopleTabs'
import { formatDate, withTimeout } from '@/lib/utils'
import { CLIENT_PORTAL_ENABLED } from '@/lib/features'
import type { Profile, Client, UserRole, ClientRequest, OfficePermissionCatalogRow } from '@/lib/types/database'

// Cosmetic staff job titles an admin can assign (display only — no permissions).
const STAFF_TITLES = ['Cargo Technician']

export default function UsersPage() {
  const [currentProfile, setCurrentProfile] = useState<Profile | null>(null)
  const [users, setUsers] = useState<Profile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [clientRequests, setClientRequests] = useState<ClientRequest[]>([])
  const [officeCatalog, setOfficeCatalog] = useState<OfficePermissionCatalogRow[]>([])
  // Toggled office permission state for the user currently being edited.
  const [officePerms, setOfficePerms] = useState<Record<string, boolean>>({})
  const [officePermsLoading, setOfficePermsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [form, setForm] = useState({
    email: '',
    full_name: '',
    role: 'surveyor' as UserRole,
    phone: '',
    password: '',
    client_id: '',
    vehicle_number: '',
    employee_number: '',
    display_title: '',
  })

  // Approval state: when approving a client-role user, we need a client link
  const [approvalTarget, setApprovalTarget] = useState<Profile | null>(null)
  const [approvalClientId, setApprovalClientId] = useState('')
  const [approvalRole, setApprovalRole] = useState<UserRole>('surveyor')
  const [approvingSaving, setApprovingSaving] = useState(false)
  const [approvalError, setApprovalError] = useState<string | null>(null)

  async function load() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const [{ data: me }, { data: u }, { data: c }, { data: cr }, { data: oc }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session?.user.id ?? '').single(),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('clients').select('*').eq('is_active', true).order('name'),
      supabase.from('client_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }),
      supabase.from('office_permission_catalog').select('*').order('category').order('label'),
    ])
    setCurrentProfile(me)
    setUsers(u ?? [])
    setClients(c ?? [])
    setClientRequests(cr ?? [])
    setOfficeCatalog(oc ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const isSuperAdmin = currentProfile?.is_super_admin === true

  // Link (or unlink) a surveyor display name to a real login profile.
  // Generic: works for any admin/surveyor profile, no person hardcoded.
  function openCreate() {
    setEditUser(null)
    setForm({ email: '', full_name: '', role: 'surveyor', phone: '', password: '', client_id: '', vehicle_number: '', employee_number: '', display_title: '' })
    setOfficePerms({})
    setError(null)
    setShowModal(true)
  }

  function openEdit(user: Profile) {
    setEditUser(user)
    setForm({ email: user.email, full_name: user.full_name, role: user.role, phone: user.phone ?? '', password: '', client_id: '', vehicle_number: (user as any).vehicle_number ?? '', employee_number: (user as any).employee_number ?? '', display_title: (user as any).display_title ?? '' })
    setOfficePerms({})
    setError(null)
    setShowModal(true)
    // Office permissions are managed only when editing; load the user's current grants.
    loadOfficePermissions(user.id)
  }

  // Load the saved office permission grants for a user into the toggle state.
  async function loadOfficePermissions(profileId: string) {
    setOfficePermsLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('office_user_permissions')
      .select('permission_key, allowed')
      .eq('profile_id', profileId)
    const map: Record<string, boolean> = {}
    for (const row of data ?? []) map[row.permission_key] = row.allowed
    setOfficePerms(map)
    setOfficePermsLoading(false)
  }

  // Persist office permission rows for an edited user.
  // - role is office: upsert the full catalog with the toggled allow state.
  // - role changed away from office: remove their grants entirely.
  // Returns an error message string, or null on success.
  async function syncOfficePermissions(
    supabase: ReturnType<typeof createClient>,
    user: Profile,
    newRole: UserRole,
  ): Promise<{ error: string | null }> {
    if (newRole === 'office') {
      if (officeCatalog.length === 0) return { error: null }
      const nowIso = new Date().toISOString()
      const rows = officeCatalog.map(c => ({
        profile_id: user.id,
        permission_key: c.key,
        allowed: !!officePerms[c.key],
        updated_by: currentProfile?.id ?? null,
        updated_at: nowIso,
      }))
      const { error } = await supabase.from('office_user_permissions').upsert(rows)
      return { error: error ? error.message : null }
    }
    // Changed away from office — clean up any existing grants.
    if (user.role === 'office') {
      const { error } = await supabase.from('office_user_permissions').delete().eq('profile_id', user.id)
      return { error: error ? error.message : null }
    }
    return { error: null }
  }

  async function handleSave() {
    if (!form.email || !form.full_name) { setError('Email and full name are required'); return }

    if (!isSuperAdmin && form.role === 'admin') {
      setError('You do not have permission to create Admin accounts. Contact the Super Admin.')
      return
    }

    setSaving(true)
    setError(null)

    const supabase = createClient()

    if (editUser) {
      const patch: any = { full_name: form.full_name, role: form.role, phone: form.phone || null }
      // Simple identifiers apply to staff (surveyor / admin) only. The richer
      // credentials (permit / ID / passport / insurance / CoC) are managed on
      // the per-user Documents page.
      if (form.role === 'surveyor' || form.role === 'admin') {
        patch.vehicle_number = form.vehicle_number || null
        patch.employee_number = form.employee_number || null
        // Cosmetic job title (e.g. Cargo Technician) — display only, no permissions.
        patch.display_title = form.display_title || null
      } else {
        // Non-staff roles never carry a cosmetic title.
        patch.display_title = null
      }
      if (!isSuperAdmin && form.role === 'admin') {
        setError('Only the Super Admin can assign the Admin role.')
        setSaving(false)
        return
      }
      if (!isSuperAdmin && (editUser as any).is_super_admin) {
        setError('You cannot edit the Super Admin account.')
        setSaving(false)
        return
      }
      const { error: err } = await supabase.from('profiles').update(patch).eq('id', editUser.id)
      if (err) { setError(err.message); setSaving(false); return }

      // Sync office permission rows (RLS enforces admin-only writes).
      const { error: permErr } = await syncOfficePermissions(supabase, editUser, form.role)
      if (permErr) { setError(permErr); setSaving(false); return }
    } else {
      if (!form.password || form.password.length < 8) { setError('Password must be at least 8 characters'); setSaving(false); return }

      let response: Response
      try {
        response = await withTimeout(fetch('/api/admin/create-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            full_name: form.full_name,
            role: form.role,
            phone: form.phone || null,
          }),
        }), 20_000, 'Creating the account')
      } catch {
        setError('Creating the account timed out — check your connection and try again. (If it was created, refresh to see it.)')
        setSaving(false)
        return
      }

      const result = await response.json()
      if (!response.ok) { setError(result.error ?? 'Failed to create user'); setSaving(false); return }

      if (form.role === 'client' && form.client_id && result.user_id) {
        await supabase.from('client_users').upsert({
          profile_id: result.user_id,
          client_id: form.client_id,
        }, { onConflict: 'profile_id,client_id' })
      }
    }

    setShowModal(false)
    setSaving(false)
    load()
  }

  // Start approval flow — for client-role users we show a modal to pick the client first.
  // Never default a non-super-admin's approval to the Admin role (a pending row could
  // already carry role='admin' from before migration 068) — drop it to surveyor so it
  // can't be approved-as-admin by accident.
  function startApprove(user: Profile) {
    setApprovalTarget(user)
    setApprovalRole(user.role === 'admin' && !isSuperAdmin ? 'surveyor' : user.role)
    setApprovalClientId('')
    setApprovalError(null)
  }

  async function confirmApprove() {
    if (!approvalTarget) return

    // Only the super admin may grant the Admin role at approval time.
    if (approvalRole === 'admin' && !isSuperAdmin) {
      setApprovalError('Only the Super Admin can approve an account as Admin.')
      return
    }

    if (approvalRole === 'client' && !approvalClientId) {
      setApprovalError('Please select the client this user belongs to.')
      return
    }

    setApprovingSaving(true)
    setApprovalError(null)
    const supabase = createClient()

    // Allow admin to change the role at approval time
    if (approvalRole !== approvalTarget.role) {
      const { error: roleErr } = await supabase
        .from('profiles')
        .update({ role: approvalRole })
        .eq('id', approvalTarget.id)
      if (roleErr) { setApprovalError(roleErr.message); setApprovingSaving(false); return }
    }

    // Create client link for client-role users
    if (approvalRole === 'client' && approvalClientId) {
      const { error: linkErr } = await supabase.from('client_users').upsert({
        profile_id: approvalTarget.id,
        client_id: approvalClientId,
      }, { onConflict: 'profile_id,client_id' })
      if (linkErr) { setApprovalError(linkErr.message); setApprovingSaving(false); return }
    }

    const { error: actErr } = await supabase
      .from('profiles')
      .update({ is_active: true })
      .eq('id', approvalTarget.id)

    if (actErr) { setApprovalError(actErr.message); setApprovingSaving(false); return }

    setApprovalTarget(null)
    setApprovingSaving(false)
    load()
  }

  async function rejectUser(user: Profile) {
    if (!(await confirmDialog({ title: 'Reject account', message: `Reject and delete the account for ${user.full_name}?`, danger: true, confirmLabel: 'Reject & delete' }))) return
    const supabase = createClient()
    const { error } = await supabase.from('profiles').delete().eq('id', user.id)
    if (error) { toast.error(error.message); return }
    toast.success('Account rejected')
    load()
  }

  async function toggleActive(user: Profile) {
    if ((user as any).is_super_admin && !isSuperAdmin) {
      toast.error('Only the Super Admin can deactivate the Super Admin account.')
      return
    }
    if (user.is_active && !(await confirmDialog({
      title: 'Deactivate account',
      message: `Deactivate ${user.full_name}? They will be signed out and blocked from the app until reactivated.`,
      danger: true, confirmLabel: 'Deactivate',
    }))) return
    const supabase = createClient()
    const { data, error } = await supabase.from('profiles').update({ is_active: !user.is_active }).eq('id', user.id).select('id')
    if (error) { toast.error(error.message); return }
    if (!data || data.length === 0) { toast.error('That change was blocked — you may not have permission to update this account.'); return }
    load()
  }

  async function approveClientRequest(req: ClientRequest) {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const { data: newClient, error: insErr } = await supabase.from('clients').insert({ name: req.requested_name, is_active: true }).select('id').single()
    if (insErr) { toast.error(insErr.message); return }
    const { error: updErr } = await supabase.from('client_requests').update({ status: 'approved', reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() }).eq('id', req.id)
    if (updErr) { toast.error(updErr.message); return }
    // Auto-fill the requesting job with the approved client (mig 155). Guarded with
    // .is('client_id', null) so a client someone set on the job in the meantime is
    // never clobbered. Best-effort; the client is created either way.
    if (req.job_id && newClient?.id) {
      const { error: linkErr } = await supabase.from('jobs').update({ client_id: newClient.id }).eq('id', req.job_id).is('client_id', null)
      if (linkErr) toast.error(`Client created, but linking it to the job failed: ${linkErr.message}`)
      else toast.success('Client approved and added to its job')
    } else {
      toast.success('Client approved')
    }
    load()
  }

  async function rejectClientRequest(req: ClientRequest) {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    const { error } = await supabase.from('client_requests').update({ status: 'rejected', reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() }).eq('id', req.id)
    if (error) { toast.error(error.message); return }
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  const roleColor: Record<string, string> = {
    admin: 'bg-red-100 text-red-700',
    surveyor: 'bg-blue-100 text-blue-700',
    client: 'bg-green-100 text-green-700',
    office: 'bg-teal-100 text-teal-700',
  }

  const pending = users.filter(u => !u.is_active)
  const term = q.trim().toLowerCase()
  const active = users.filter(u => {
    if (!u.is_active) return false
    if (roleFilter && u.role !== roleFilter) return false
    if (!term) return true
    return [u.full_name, u.email, u.role, (u as any).display_title]
      .some(v => (v ?? '').toLowerCase().includes(term))
  })
  const totalPendingRequests = clientRequests.length

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <PeopleTabs />
      <PageHeader
        title="Team"
        subtitle={<>
          {users.length} members
          {pending.length > 0 && ` · ${pending.length} pending approval`}
          {totalPendingRequests > 0 && ` · ${totalPendingRequests} pending request${totalPendingRequests > 1 ? 's' : ''}`}
        </>}
        actions={<button onClick={openCreate} className="btn-primary"><Plus className="h-4 w-4" />Add member</button>}
      />

      {/* Pending user approvals */}
      {pending.length > 0 && (
        <div className="card overflow-hidden border-yellow-200 border-2">
          <div className="px-4 py-3 bg-yellow-50 border-b border-yellow-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-sm font-semibold text-yellow-800">{pending.length} account{pending.length > 1 ? 's' : ''} awaiting approval</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {pending.map(user => (
                <tr key={user.id} className="hover:bg-yellow-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center text-yellow-700 font-medium text-sm flex-shrink-0">
                        {user.full_name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{user.full_name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor[user.role]}`}>
                      Requested: {user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(user.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startApprove(user)}
                        className="btn-primary py-1 px-3 text-xs"
                      >
                        Review &amp; Approve
                      </button>
                      <button onClick={() => rejectUser(user)} className="btn-ghost py-1 px-3 text-xs text-red-600 hover:text-red-700 hover:bg-red-50">
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Pending client name requests */}
      {clientRequests.length > 0 && (
        <div className="card overflow-hidden border-pink-200 border-2">
          <div className="px-4 py-3 bg-pink-50 border-b border-pink-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
            <span className="text-sm font-semibold text-pink-800">{clientRequests.length} new client request{clientRequests.length > 1 ? 's' : ''}</span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {clientRequests.map(req => (
                <tr key={req.id} className="hover:bg-pink-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{req.requested_name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(req.created_at)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => approveClientRequest(req)} className="btn-primary py-1 px-3 text-xs">Approve</button>
                      <button onClick={() => rejectClientRequest(req)} className="btn-ghost py-1 px-3 text-xs text-red-600 hover:bg-red-50">Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Active users — search + role filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email or role…" className="input-base pl-9" />
        </div>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} className="input-base sm:w-44 capitalize">
          <option value="">All roles</option>
          <option value="admin">Admin</option>
          <option value="surveyor">Surveyor</option>
          <option value="office">Office</option>
          <option value="client">Client</option>
        </select>
      </div>

      {/* Active users table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-700">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Email</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700">Joined</th>
              <th className="text-left px-4 py-3 font-medium text-gray-700"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {active.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No active users match your search.</td></tr>
            )}
            {active.map(user => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-medium text-sm flex-shrink-0">
                      {user.full_name.charAt(0)}
                    </div>
                    <div>
                      <a href={`/admin/users/${user.id}`} className="font-medium text-gray-900 hover:text-brand-700 hover:underline">{user.full_name}</a>
                      {(user as any).is_super_admin && (
                        <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                          <ShieldCheck className="h-3 w-3" />Super Admin
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor[user.role]}`}>
                    {(user as any).display_title ?? user.role}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {user.is_active ? (
                    <span className="flex items-center gap-1 text-green-600 text-xs font-medium">
                      <Check className="h-3.5 w-3.5" /> Active
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-gray-400 text-xs font-medium">
                      <X className="h-3.5 w-3.5" /> Inactive
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDate(user.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {(isSuperAdmin || user.role !== 'admin') && !(user as any).is_super_admin && (
                      <button onClick={() => openEdit(user)} className="text-xs btn-ghost py-1 px-2">
                        <Pencil className="h-3.5 w-3.5" />Edit
                      </button>
                    )}
                    {(user.role === 'surveyor' || user.role === 'admin') && (
                      <a href={`/admin/users/${user.id}/documents`} className="text-xs btn-ghost py-1 px-2">
                        <FileText className="h-3.5 w-3.5" />Docs
                      </a>
                    )}
                    {(isSuperAdmin || !(user as any).is_super_admin) && (
                      <button
                        onClick={() => toggleActive(user)}
                        className="text-xs text-gray-500 hover:text-gray-700"
                      >
                        {user.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Create / Edit user modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editUser ? 'Edit User' : 'Add User'}
        footer={
          <>
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : editUser ? 'Save Changes' : 'Create User'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="label-base">Full Name *</label>
            <input type="text" value={form.full_name} onChange={(e) => setForm(p => ({ ...p, full_name: e.target.value }))} className="input-base" />
          </div>
          {!editUser && (
            <div>
              <label className="label-base">Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm(p => ({ ...p, email: e.target.value }))} className="input-base" />
            </div>
          )}
          {editUser && (
            <div>
              <label className="label-base">Email</label>
              <input type="email" value={form.email} disabled className="input-base opacity-60" />
            </div>
          )}
          {!editUser && (
            <div>
              <label className="label-base">Password *</label>
              <input type="password" value={form.password} onChange={(e) => setForm(p => ({ ...p, password: e.target.value }))} className="input-base" placeholder="Min. 8 characters" />
            </div>
          )}
          <div>
            <label className="label-base">Role</label>
            <select value={form.role} onChange={(e) => setForm(p => ({ ...p, role: e.target.value as UserRole }))} className="input-base">
              <option value="surveyor">Surveyor</option>
              {/* Creating a client account is pointless while the portal is off (they
                  can't sign in). The role filter and approval flow keep 'client' so
                  any pre-existing client records stay manageable. */}
              {(CLIENT_PORTAL_ENABLED || form.role === 'client') && <option value="client">Client</option>}
              <option value="office">Office</option>
              {isSuperAdmin && <option value="admin">Admin</option>}
            </select>
            {!isSuperAdmin && (
              <p className="text-xs text-gray-400 mt-1">Only the Super Admin can create Admin accounts.</p>
            )}
          </div>
          {/* Cosmetic job title for staff (e.g. Cargo Technician). Display only —
              same role/permissions as a surveyor. Editing existing users only. */}
          {editUser && (form.role === 'surveyor' || form.role === 'admin') && (
            <div>
              <label className="label-base">Job title</label>
              <select value={form.display_title} onChange={(e) => setForm(p => ({ ...p, display_title: e.target.value }))} className="input-base">
                <option value="">Default ({form.role === 'admin' ? 'Admin' : 'Surveyor'})</option>
                {STAFF_TITLES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-1">Cosmetic title shown in place of the role. Same access as a surveyor.</p>
            </div>
          )}
          {form.role === 'client' && !editUser && (
            <div>
              <label className="label-base">Link to Client</label>
              <select value={form.client_id} onChange={(e) => setForm(p => ({ ...p, client_id: e.target.value }))} className="input-base">
                <option value="">Select client&hellip;</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label-base">Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} className="input-base" placeholder="+1 555 000 0000" />
          </div>

          {/* Identifiers — staff only. Richer credentials live on the Documents page. */}
          {(form.role === 'surveyor' || form.role === 'admin') && (
            <div className="border-t border-gray-100 pt-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-900">Employee details</p>
                <p className="text-xs text-gray-400">Vehicle &amp; employee numbers. Permit, ID, passport, insurance and CoC are managed under Documents.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="label-base">Employee #</label>
                  <input type="text" value={form.employee_number} onChange={(e) => setForm(p => ({ ...p, employee_number: e.target.value }))} className="input-base" />
                </div>
                <div>
                  <label className="label-base">Vehicle #</label>
                  <input type="text" value={form.vehicle_number} onChange={(e) => setForm(p => ({ ...p, vehicle_number: e.target.value }))} className="input-base" />
                </div>
              </div>
              {editUser && (
                <a href={`/admin/users/${editUser.id}/documents`} className="inline-flex items-center gap-1.5 text-sm text-brand-600 hover:text-brand-800 font-medium">
                  <FileText className="h-4 w-4" />Manage credentials &amp; documents
                </a>
              )}
            </div>
          )}

          {/* Office permissions — only when editing an existing office user.
              New office users start with everything denied; grant access here. */}
          {editUser && form.role === 'office' && (
            <div className="border-t border-gray-100 pt-4">
              <label className="label-base">Office Permissions</label>
              <p className="text-xs text-gray-400 mb-2">
                Office staff are read-only. Grant only what this person needs; access is enforced by the database.
              </p>
              {officePermsLoading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading permissions…
                </div>
              ) : officeCatalog.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">No permission catalog found. Run migration 025.</p>
              ) : (
                <div className="space-y-1.5">
                  {officeCatalog.map(perm => (
                    <label key={perm.key} className="flex items-start gap-3 p-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!officePerms[perm.key]}
                        onChange={(e) => setOfficePerms(p => ({ ...p, [perm.key]: e.target.checked }))}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{perm.label}</p>
                        {perm.description && <p className="text-xs text-gray-500">{perm.description}</p>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Approval modal — always shown; client-role users require a client selection */}
      <Modal
        open={!!approvalTarget}
        onClose={() => setApprovalTarget(null)}
        title={`Approve Account — ${approvalTarget?.full_name ?? ''}`}
        size="sm"
        footer={
          <>
            <button onClick={() => setApprovalTarget(null)} className="btn-secondary">Cancel</button>
            <button onClick={confirmApprove} disabled={approvingSaving} className="btn-primary">
              {approvingSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {approvingSaving ? 'Approving…' : 'Approve & Activate'}
            </button>
          </>
        }
      >
        {approvalTarget && (
          <div className="space-y-4">
            {approvalError && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{approvalError}</div>
            )}

            <p className="text-sm text-gray-600">
              Review the details below before activating <strong>{approvalTarget.full_name}</strong>&apos;s account.
            </p>

            <div>
              <label className="label-base">Role</label>
              <select
                value={approvalRole}
                onChange={(e) => { setApprovalRole(e.target.value as UserRole); setApprovalClientId('') }}
                className="input-base"
              >
                <option value="surveyor">Surveyor</option>
                <option value="client">Client</option>
                <option value="office">Office</option>
                {isSuperAdmin && <option value="admin">Admin</option>}
              </select>
            </div>

            {approvalRole === 'client' && (
              <div>
                <label className="label-base">
                  Link to Client <span className="text-red-500">*</span>
                </label>
                <select
                  value={approvalClientId}
                  onChange={(e) => setApprovalClientId(e.target.value)}
                  className="input-base"
                >
                  <option value="">Select client&hellip;</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-xs text-gray-500 mt-1">Client users must be linked to a client company to access jobs.</p>
              </div>
            )}
          </div>
        )}
      </Modal>

    </div>
  )
}
