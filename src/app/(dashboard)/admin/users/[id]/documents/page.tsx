'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Loader2, ArrowLeft, User } from 'lucide-react'
import CredentialsManager from '@/components/personal-docs/CredentialsManager'

interface Person { id: string; full_name: string; role: string }

export default function AdminUserDocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [person, setPerson] = useState<Person | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await createClient()
        .from('profiles').select('id, full_name, role').eq('id', id).single()
      setPerson((data as Person) ?? null)
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
            <p className="text-gray-500 mt-0.5">Credentials &amp; documents — view, edit and upload on this person&apos;s behalf.</p>
          </div>
          <div className="card p-5">
            <CredentialsManager profileId={person.id} canManage ownerName={person.full_name} showCopy />
          </div>
        </>
      )}
    </div>
  )
}
