'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Plus, Loader2, Building2, Pencil, Check, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { formatDate } from '@/lib/utils'
import type { Client } from '@/lib/types/database'

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editClient, setEditClient] = useState<Client | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({})
  const [form, setForm] = useState({
    name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    address: '',
    notes: '',
  })

  async function load() {
    const supabase = createClient()
    const { data: c } = await supabase.from('clients').select('*').order('name')
    setClients(c ?? [])

    // Get job counts per client
    const counts: Record<string, number> = {}
    for (const client of (c ?? [])) {
      const { count } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('client_id', client.id)
      counts[client.id] = count ?? 0
    }
    setJobCounts(counts)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditClient(null)
    setForm({ name: '', contact_name: '', contact_email: '', contact_phone: '', address: '', notes: '' })
    setError(null)
    setShowModal(true)
  }

  function openEdit(client: Client) {
    setEditClient(client)
    setForm({
      name: client.name,
      contact_name: client.contact_name ?? '',
      contact_email: client.contact_email ?? '',
      contact_phone: client.contact_phone ?? '',
      address: client.address ?? '',
      notes: client.notes ?? '',
    })
    setError(null)
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Client name is required'); return }
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const payload = {
      name: form.name.trim(),
      contact_name: form.contact_name || null,
      contact_email: form.contact_email || null,
      contact_phone: form.contact_phone || null,
      address: form.address || null,
      notes: form.notes || null,
    }

    if (editClient) {
      const { error: err } = await supabase.from('clients').update(payload).eq('id', editClient.id)
      if (err) { setError(err.message); setSaving(false); return }
    } else {
      const { error: err } = await supabase.from('clients').insert(payload)
      if (err) { setError(err.message); setSaving(false); return }
    }

    setShowModal(false)
    setSaving(false)
    load()
  }

  async function toggleActive(client: Client) {
    const supabase = createClient()
    await supabase.from('clients').update({ is_active: !client.is_active }).eq('id', client.id)
    load()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Clients</h1>
          <p className="text-gray-500 mt-1">{clients.length} clients</p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="h-4 w-4" />
          Add Client
        </button>
      </div>

      {clients.length === 0 ? (
        <div className="card py-16 text-center">
          <Building2 className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No clients yet</h3>
          <p className="text-gray-500 text-sm mb-6">Add your first client to start assigning jobs.</p>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" />
            Add Client
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(client => (
            <div key={client.id} className={`card p-5 ${!client.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-5 w-5 text-indigo-700" />
                </div>
                <div className="flex items-center gap-1">
                  {client.is_active ? (
                    <span className="text-xs text-green-600 font-medium flex items-center gap-0.5"><Check className="h-3 w-3" />Active</span>
                  ) : (
                    <span className="text-xs text-gray-400 font-medium">Inactive</span>
                  )}
                </div>
              </div>
              <h3 className="font-semibold text-gray-900">{client.name}</h3>
              {client.contact_name && <p className="text-sm text-gray-600 mt-0.5">{client.contact_name}</p>}
              {client.contact_email && <p className="text-sm text-gray-500">{client.contact_email}</p>}
              {client.contact_phone && <p className="text-sm text-gray-500">{client.contact_phone}</p>}

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">{jobCounts[client.id] ?? 0} jobs</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => openEdit(client)} className="text-xs btn-ghost py-1 px-2">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button onClick={() => toggleActive(client)} className="text-xs text-gray-500 hover:text-gray-700">
                    {client.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editClient ? 'Edit Client' : 'Add Client'}
        footer={
          <>
            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : editClient ? 'Save Changes' : 'Add Client'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}
          <div>
            <label className="label-base">Client Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} className="input-base" placeholder="e.g. Acme Shipping Co." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-base">Contact Name</label>
              <input type="text" value={form.contact_name} onChange={(e) => setForm(p => ({ ...p, contact_name: e.target.value }))} className="input-base" />
            </div>
            <div>
              <label className="label-base">Contact Phone</label>
              <input type="tel" value={form.contact_phone} onChange={(e) => setForm(p => ({ ...p, contact_phone: e.target.value }))} className="input-base" />
            </div>
          </div>
          <div>
            <label className="label-base">Contact Email</label>
            <input type="email" value={form.contact_email} onChange={(e) => setForm(p => ({ ...p, contact_email: e.target.value }))} className="input-base" />
          </div>
          <div>
            <label className="label-base">Address</label>
            <textarea value={form.address} onChange={(e) => setForm(p => ({ ...p, address: e.target.value }))} className="input-base resize-none" rows={2} />
          </div>
          <div>
            <label className="label-base">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} className="input-base resize-none" rows={2} placeholder="Internal notes about this client" />
          </div>
        </div>
      </Modal>
    </div>
  )
}
