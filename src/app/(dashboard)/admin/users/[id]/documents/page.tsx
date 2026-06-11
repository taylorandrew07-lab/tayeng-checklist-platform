'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ArrowLeft, User } from 'lucide-react'
import PersonalDocsManager from '@/components/personal-docs/PersonalDocsManager'

interface Surveyor {
  id: string; full_name: string; role: string
  vehicle_number: string | null; drivers_permit_number: string | null
  id_card_number: string | null; passport_number: string | null; employee_number: string | null
}

const PASS_FIELDS: [keyof Surveyor, string][] = [
  ['employee_number', 'Employee #'],
  ['vehicle_number', 'Vehicle #'],
  ['drivers_permit_number', "Driver's permit #"],
  ['id_card_number', 'ID card #'],
  ['passport_number', 'Passport #'],
]

export default function AdminUserDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [person, setPerson] = useState<Surveyor | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role, vehicle_number, drivers_permit_number, id_card_number, passport_number, employee_number')
        .eq('id', id).single()
      setPerson((data as Surveyor) ?? null)
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href="/admin/users" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" />Back to users
      </Link>

      {!person ? (
        <div className="card p-12 text-center text-gray-400"><User className="h-10 w-10 text-gray-300 mx-auto mb-3" />User not found.</div>
      ) : (
        <>
          <div>
            <h1 className="page-title">{person.full_name}</h1>
            <p className="text-gray-500 mt-0.5">Employee details &amp; credential documents.</p>
          </div>

          <div className="card p-5">
            <p className="text-xs font-medium text-gray-500 mb-3">Employee details</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
              {PASS_FIELDS.map(([k, label]) => (
                <div key={k as string}>
                  <p className="text-[11px] text-gray-400">{label}</p>
                  <p className="text-sm text-gray-900">{person[k] || '—'}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-3">Edit these fields from the user&apos;s Edit dialog on the Users page.</p>
          </div>

          <div className="card p-5">
            <p className="text-xs font-medium text-gray-500 mb-3">Documents</p>
            <PersonalDocsManager profileId={person.id} canManage />
          </div>
        </>
      )}
    </div>
  )
}
