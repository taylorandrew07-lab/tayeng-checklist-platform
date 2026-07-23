import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'

// One page header for the whole app: an optional back link, an optional brand icon
// tile, the title, an optional subtitle, and optional right-aligned actions.
// Replaces the slightly different header treatments each page grew on its own, so
// every page reads as the same product. Detail pages use `back` instead of
// hand-rolling their own back arrow.

export default function PageHeader({ title, subtitle, icon: Icon, actions, back }: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
  /** Back link for detail pages — renders a labelled arrow above the title. */
  back?: { href: string; label: string }
}) {
  return (
    <div className="space-y-2">
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 rounded"
        >
          <ArrowLeft className="h-4 w-4" />
          {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-brand-600" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="page-title">{title}</h1>
            {subtitle && <p className="text-gray-500 text-sm mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
    </div>
  )
}
