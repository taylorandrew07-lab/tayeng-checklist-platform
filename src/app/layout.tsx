import type { Metadata, Viewport } from 'next'
import './globals.css'
import { Toaster } from '@/components/ui/toast'
import { ConfirmHost } from '@/components/ui/confirm'

export const metadata: Metadata = {
  title: {
    default: 'Tayeng App',
    template: '%s | TEAL',
  },
  description: 'Internal survey & job management app for Taylor Engineering Agencies Limited',
  manifest: '/manifest.json',
  icons: {
    icon: '/logo-square.png',
    shortcut: '/logo-square.png',
    apple: '/logo-square.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Tayeng App',
  },
}

export const viewport: Viewport = {
  themeColor: '#1d4ed8',
  width: 'device-width',
  initialScale: 1,
  // No maximumScale — pinch-zoom stays available for accessibility.
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  )
}
