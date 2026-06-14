'use client'

import { useParams } from 'next/navigation'
import ClientCargoWorkspace from '@/components/cargo/ClientCargoWorkspace'

// Office drill-in to a SYNCED voyage. Read-only data, but staff get the full DRI
// Production Report builder (PDF/.docx) so the office can issue reports from the
// cloud. Access is gated by RLS ('cargo.view' office permission, migration 062).
export default function OfficeCargoVoyagePage() {
  const params = useParams<{ id: string }>()
  return <ClientCargoWorkspace id={params.id} backHref="/office/cargo" allowDri />
}
