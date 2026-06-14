'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'

// Catches render/runtime errors anywhere under the dashboard so a single page
// fault shows a friendly retry instead of a blank crash. Route-specific
// boundaries (e.g. inbox) still take precedence where they exist.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="max-w-lg mx-auto text-center py-20 space-y-4">
      <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
        <AlertTriangle className="h-7 w-7 text-amber-600" />
      </div>
      <h1 className="page-title">Something went wrong</h1>
      <p className="text-sm text-gray-600 break-words">{error?.message || 'This page hit an unexpected error.'}</p>
      {error?.digest && <p className="text-xs text-gray-400">Ref: {error.digest}</p>}
      <button onClick={reset} className="btn-primary"><RefreshCw className="h-4 w-4" />Try again</button>
    </div>
  )
}
