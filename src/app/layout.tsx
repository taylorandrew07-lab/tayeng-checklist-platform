import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/toast'
import { ConfirmHost } from '@/components/ui/confirm'

// Self-hosted via next/font — no render-blocking third-party request to Google.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
})

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
    <html lang="en" className={inter.variable}>
      <body>
        {children}
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  )
}
