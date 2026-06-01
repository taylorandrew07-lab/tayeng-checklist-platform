'use client'

import { useRef } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import JobChecklistEditor, { type JobChecklistEditorHandle } from '@/components/job/JobChecklistEditor'

export default function SurveyorJobPage() {
  const params = useParams()
  const jobId = params.id as string
  const editorRef = useRef<JobChecklistEditorHandle>(null)

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5">
        <button
          onClick={() => editorRef.current?.navigate('/surveyor')}
          className="btn-ghost py-2 px-3"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </div>
      <JobChecklistEditor ref={editorRef} jobId={jobId} backHref="/surveyor" />
    </div>
  )
}
