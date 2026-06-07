'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import VoyageSetupForm from '@/components/cargo/VoyageSetupForm'

export default function NewCargoVoyagePage() {
  const router = useRouter()
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/surveyor/cargo" className="btn-ghost py-2 px-3"><ArrowLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="page-title">New Voyage</h1>
          <p className="text-gray-500 mt-0.5">Set up a cargo hold monitoring voyage.</p>
        </div>
      </div>

      <VoyageSetupForm
        submitLabel="Create Voyage"
        onSaved={voyage => router.push(`/surveyor/cargo/${voyage.id}`)}
      />
    </div>
  )
}
