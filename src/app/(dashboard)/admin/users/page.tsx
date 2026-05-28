'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Loader2, Users, Check, X, Pencil } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import type { Profile, Client, UserRole } from '@/lib/types/database'

export default function UsersPage() {
  const [users, setUsers] = useState<Profile[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editUser, setEditUser] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    email: '',
    full_name: '',
    role: 'surveyor' as UserRole,
    phone: '',
    password: '',
    client_id: '',
  })

  async function load() {
    const supabase = createClient()
    const [{ data: u }, { data: c }] = await Promise.all([
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('clients').select('*').eq('is_active', true).order('name'),
    ])
    setUsers(u ?? [])
    setClients(c ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditUser(null)
    setForm({ email: '', full_name: '', role: 'surveyor', phone: '', password: '', client_id: '' })
    setError(null)
    setShowModal(true)
  }

  function openEdit(user: Profile) {
    setEditUser(user)
    setForm({ email: user.email, full_name: user.full_name, role: user.role, phone: user.phone ?? '', password: '', client_id: '' })
    setError(null)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.email || !form.full_name) { setError('Email and full name are required'); return }
    setSaving(true)
    setError(null)

    const supabase = createClient()

    if (editUser) {
      const { error: err } = await supabase
        .from('profiles')
        .update({ full_name: form.full_name, role: form.role, phone: form.phone || null })
        .eq('id', editUser.id)

      if (err) { setError(err.message); setSaving(false); return }
    } else {
      if (!form.password || form.password.length < 8) { setError('Password must be at least 8 characters'); setSaving(false); return }

      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          role: form.role,
          phone: form.phone || null,
        }),
      })

      const result = await response.json()
      if (!response.ok) { setError(result.error ?? 'Failed to create user'); setSaving(false); return }

      // Link to client if client role
      if (form.role === 'client' && form.client_id && result.user_id) {
        await supabase.from('client_users').upsert({
          profile_id: result.user_id,
          client_id: form.client_id,
        })
      }
    }

    setShowModal(false)
    setSaving(false)
    load()
  }

  async function toggleActive(user: Profile) {
    const supabase = createClient()
    await supabase.from('profiles').update({ is_active: !user.is_active }).eq('id', user.id)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  const roleColor: Record<UserRole, string> = {
    admin: 'bg-red-100 text-red-700',
    surveyor: 'bg-blue-100 text-blue-700',
    client: 'bg-green-100 text-green-700',
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="text-gray-500 mt-1">{users.length} users</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      <div className="card overflow-hidden">
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
            {users.map(user => (
              <tr key={user.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-medium text-sm flex-shrink-0">
                      {user.full_name.charAt(0)}
                    </div>
                    <span className="font-medium text-gray-900">{user.full_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">{user.email}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor[user.role]}`}>
                    {user.role}
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
                    <button onClick={() => openEdit(user)} className="text-xs btn-ghost py-1 px-2">
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(user)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      {user.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
              <option value="admin">Admin</option>
              <option value="surveyor">Surveyor</option>
              <option value="client">Client</option>
            </select>
          </div>
          {form.role === 'client' && !editUser && (
            <div>
              <label className="label-base">Link to Client</label>
              <select value={form.client_id} onChange={(e) => setForm(p => ({ ...p, client_id: e.target.value }))} className="input-base">
                <option value="">Select client…</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label-base">Phone</label>
            <input type="tel" value={form.phone} onChange={(e) => setForm(p => ({ ...p, phone: e.target.value }))} className="input-base" placeholder="+1 555 000 0000" />
          </div>
        </div>
      </Modal>
    </div>
  )
}
