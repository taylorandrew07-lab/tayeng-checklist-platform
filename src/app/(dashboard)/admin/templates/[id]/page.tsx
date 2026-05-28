import { redirect } from 'next/navigation'

export default function TemplateViewPage({ params }: { params: { id: string } }) {
  redirect(`/admin/templates/${params.id}/edit`)
}
