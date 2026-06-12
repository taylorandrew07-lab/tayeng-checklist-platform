import Link from 'next/link'

export const metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-6 bg-gray-50">
      <div className="text-center max-w-sm">
        <p className="text-6xl font-bold tracking-tight text-brand-700 tnum">404</p>
        <h1 className="mt-3 text-xl font-semibold text-gray-900">Page not found</h1>
        <p className="mt-2 text-sm text-gray-500">
          The page you&apos;re looking for doesn&apos;t exist or may have moved.
        </p>
        <Link href="/" className="btn-primary mt-6 inline-flex">Back to the app</Link>
      </div>
    </main>
  )
}
