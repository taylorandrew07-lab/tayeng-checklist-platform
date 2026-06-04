import { WifiOff } from 'lucide-react'

export const metadata = { title: 'Offline' }

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <div className="max-w-sm text-center">
        <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-4">
          <WifiOff className="h-7 w-7 text-gray-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">You&apos;re offline</h1>
        <p className="text-sm text-gray-500 mt-2">
          This page isn&apos;t available offline. A checklist you&apos;ve already opened while online
          will keep working — reopen it to continue. Your answers are saved on this device and
          will sync automatically when you&apos;re back online.
        </p>
      </div>
    </div>
  )
}
