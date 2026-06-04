'use client'

import { useState, useEffect } from 'react'
import { Receipt, Lock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'

export default function OfficeInvoicing() {
  const [canView, setCanView] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const granted = await fetchMyOfficePermissions(supabase)
      setCanView(
        granted.has(OFFICE_PERMISSIONS.INVOICING_VIEW) ||
        granted.has(OFFICE_PERMISSIONS.INVOICING_MANAGE)
      )
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="page-title">Invoicing</h1>
        <p className="text-gray-500 mt-1">Office invoicing workspace</p>
      </div>

      {loading ? (
        <div className="card p-10 text-center text-gray-400">Loading…</div>
      ) : !canView ? (
        <div className="card p-8 text-center space-y-2">
          <Lock className="h-8 w-8 text-gray-300 mx-auto" />
          <p className="text-sm font-medium text-gray-700">No invoicing access</p>
          <p className="text-sm text-gray-500">An administrator needs to grant you invoicing permission.</p>
        </div>
      ) : (
        <div className="card p-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center mx-auto">
            <Receipt className="h-7 w-7 text-brand-600" />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">Invoicing is coming soon</h2>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            This is where office staff will create and manage invoices for completed jobs.
            The feature is being built — nothing to do here yet.
          </p>
        </div>
      )}
    </div>
  )
}
