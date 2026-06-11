'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Lock, User } from 'lucide-react'
import { fetchMyOfficePermissions, OFFICE_PERMISSIONS } from '@/lib/office/permissions'
import CredentialsManager from '@/components/personal-docs/CredentialsManager'

interface Surveyor { id: string; full_name: string }

export default function OfficeDocumentsPage() {
  const [allowed, setAllowed] = useState(true)
  const [surveyors, setSurveyors] = useState<Surveyor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const granted = await fetchMyOfficePermissions(supabase)
      if (!granted.has(OFFICE_PERMISSIONS.PERSONAL_DOCS_VIEW)) { setAllowed(false); setLoading(false); return }
      const { data } = await supabase
        .from('profiles').select('id, full_name')
        .eq('role', 'surveyor').eq('is_active', true).order('full_name')
      setSurveyors((data as Surveyor[]) ?? [])
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
  if (!allowed) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <Lock className="h-10 w-10 text-gray-300 mx-auto mb-3" />
        <h1 className="page-title mb-2">No access</h1>
        <p className="text-gray-500">You don&apos;t have permission to view surveyor documents. Ask an administrator to grant it.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="page-title">Surveyor Documents</h1>
        <p className="text-gray-500 mt-0.5">Read-only — copy pass details and download credential documents.</p>
      </div>

      {surveyors.length === 0 ? (
        <div className="card p-12 text-center text-gray-400"><User className="h-10 w-10 text-gray-300 mx-auto mb-3" />No active surveyors.</div>
      ) : surveyors.map(s => (
        <div key={s.id} className="card p-5">
          <h2 className="font-semibold text-gray-900 mb-3">{s.full_name}</h2>
          <CredentialsManager profileId={s.id} canManage={false} ownerName={s.full_name} showCopy />
        </div>
      ))}
    </div>
  )
}
