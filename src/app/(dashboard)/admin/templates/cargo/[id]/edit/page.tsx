'use client'

import { useParams } from 'next/navigation'
import CargoTemplateEditor from '@/components/cargo/CargoTemplateEditor'

export default function EditCargoTemplatePage() {
  const params = useParams<{ id: string }>()
  return <CargoTemplateEditor templateId={params.id} />
}
