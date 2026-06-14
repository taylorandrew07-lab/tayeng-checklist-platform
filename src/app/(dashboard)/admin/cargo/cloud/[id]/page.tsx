'use client'

import { useParams } from 'next/navigation'
import ClientCargoWorkspace from '@/components/cargo/ClientCargoWorkspace'

// Admin drill-in to a SYNCED voyage from Cargo Operations. Reads the cloud copy
// (admin RLS returns every voyage), so it works regardless of which surveyor's
// device the voyage was created on. Read-only data, but staff get the full DRI
// Production Report builder (PDF/.docx) so the office can issue reports from the
// cloud rather than depending on the surveyor's device.
export default function AdminCloudCargoVoyagePage() {
  const params = useParams<{ id: string }>()
  return <ClientCargoWorkspace id={params.id} backHref="/admin/cargo" allowDri />
}
