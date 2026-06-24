import type { LucideIcon } from 'lucide-react'

// One empty-state for the whole app: a soft icon tile, a title, an optional
// description, and an optional action. Replaces the many one-off
// "card p-8 text-center text-gray-400" blocks so empty screens look intentional
// and consistent everywhere.

export default function EmptyState({ icon: Icon, title, description, action }: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="card p-10 text-center space-y-3">
      {Icon && (
        <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto">
          <Icon className="h-6 w-6 text-gray-400" />
        </div>
      )}
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-700">{title}</p>
        {description && <p className="text-sm text-gray-500 max-w-sm mx-auto">{description}</p>}
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
