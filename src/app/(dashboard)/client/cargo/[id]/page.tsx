'use client'

import { useParams } from 'next/navigation'
import ClientCargoWorkspace from '@/components/cargo/ClientCargoWorkspace'

export default function ClientCargoVoyagePage() {
  const params = useParams<{ id: string }>()
  return <ClientCargoWorkspace id={params.id} />
}
