'use client'

import { useParams } from 'next/navigation'
import VesselFolderView from '@/components/documents/VesselFolderView'

export default function SurveyorVesselFolderPage() {
  const params = useParams<{ vesselId: string }>()
  return <VesselFolderView id={params.vesselId} basePath="/surveyor/documents" />
}
