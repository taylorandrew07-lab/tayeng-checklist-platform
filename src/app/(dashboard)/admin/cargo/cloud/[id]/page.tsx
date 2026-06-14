'use client'

import { useParams } from 'next/navigation'
import ClientCargoWorkspace from '@/components/cargo/ClientCargoWorkspace'

// Admin drill-in to a SYNCED voyage from Cargo Operations. Reads the cloud copy
// (admin RLS returns every voyage), so it works regardless of which surveyor's
// device the voyage was created on. Read-only, same view clients get.
export default function AdminCloudCargoVoyagePage() {
  const params = useParams<{ id: string }>()
  return <ClientCargoWorkspace id={params.id} backHref="/admin/cargo" />
}
