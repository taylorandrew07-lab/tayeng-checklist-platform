'use client'

import { AlertTriangle } from 'lucide-react'

export default function InboxError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-lg mx-auto text-center py-16 space-y-3">
      <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto" />
      <h1 className="page-title">The inbox hit an error</h1>
      <p className="text-sm text-gray-600 break-words">{error?.message || 'Something went wrong loading your messages.'}</p>
      {error?.digest && <p className="text-xs text-gray-400">Ref: {error.digest}</p>}
      <button onClick={reset} className="btn-primary">Try again</button>
    </div>
  )
}
