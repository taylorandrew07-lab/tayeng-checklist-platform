'use client'

// Client button for downloading/sharing a checklist PDF — usable inside server
// components (e.g. the client job page). Shares on mobile, downloads on desktop.

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/toast'
import { deliverJobPdf } from '@/lib/pdf/deliver'

export default function JobPdfButton({ jobId, className = 'btn-primary', label = 'Download / Share PDF' }: {
  jobId: string
  className?: string
  label?: string
}) {
  const [sharing, setSharing] = useState(false)
  async function go() {
    setSharing(true)
    try {
      await deliverJobPdf(jobId)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download the report.')
    } finally {
      setSharing(false)
    }
  }
  return (
    <button onClick={go} disabled={sharing} className={className}>
      {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
    </button>
  )
}
