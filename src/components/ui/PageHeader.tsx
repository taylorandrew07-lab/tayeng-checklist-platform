import type { LucideIcon } from 'lucide-react'

// One page header for the whole app: an optional brand icon tile, the title, an
// optional subtitle, and optional right-aligned actions. Replaces the slightly
// different header treatments each page grew on its own, so every page reads as
// the same product.

export default function PageHeader({ title, subtitle, icon: Icon, actions }: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
}) {
  return (
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
  )
}
