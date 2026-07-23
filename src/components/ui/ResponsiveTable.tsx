'use client'

// One table→cards primitive for the whole app. A desktop <table> at `md` and up,
// a stacked-card list below it, from ONE column config — so row actions (Edit /
// Delete / Approve …) are never stranded off-screen behind a horizontal scroll on
// a phone. Modelled on InvoicesTable, which was the only correct hand-rolled copy.
//
//   <ResponsiveTable
//     rows={users}
//     rowKey={u => u.id}
//     columns={[
//       { key: 'name', header: 'Name', cell: u => u.full_name },
//       { key: 'role', header: 'Role', cell: u => <RolePill role={u.role} /> },
//       { key: 'actions', header: '', align: 'right', primary: false,
//         cell: u => <RowDeleteButton onDelete={() => remove(u.id)} /> },
//     ]}
//   />
//
// Each column can opt out of the mobile card with `mobileHidden`, and one column
// marked `primary` becomes the card's headline. For a fully bespoke card, pass
// `mobileCard`.

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Column header/cell className (e.g. widths). */
  className?: string
  /** Hide this column from the stacked mobile card. */
  mobileHidden?: boolean
  /** This column is the card headline on mobile (renders large, top of card). */
  primary?: boolean
  /** Label shown before the value on the mobile card (defaults to the header text). */
  mobileLabel?: ReactNode
}

interface Props<T> {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  /** Optional whole-row link/handler on desktop rows. */
  onRowClick?: (row: T) => void
  /** Fully custom mobile card; overrides the default stacked rendering. */
  mobileCard?: (row: T) => ReactNode
  /** Breakpoint at which the table appears (default md). */
  className?: string
}

export function ResponsiveTable<T>({ rows, columns, rowKey, onRowClick, mobileCard, className }: Props<T>) {
  return (
    <div className={className}>
      {/* Desktop table */}
      <div className="hidden md:block card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-400">
              {columns.map(c => (
                <th key={c.key} className={cn('font-medium px-4 py-2.5', c.align === 'right' && 'text-right', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-gray-50 last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer hover:bg-gray-50/60',
                )}
              >
                {columns.map(c => (
                  <td key={c.key} className={cn('px-4 py-3', c.align === 'right' && 'text-right')}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {rows.map(row => {
          if (mobileCard) return <div key={rowKey(row)}>{mobileCard(row)}</div>
          const primary = columns.find(c => c.primary)
          const rest = columns.filter(c => !c.primary && !c.mobileHidden)
          return (
            <div key={rowKey(row)} className="card p-4">
              {primary && <div className="font-medium text-gray-900">{primary.cell(row)}</div>}
              <dl className="mt-1 space-y-1">
                {rest.map(c => (
                  <div key={c.key} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="text-xs text-gray-400">{c.mobileLabel ?? c.header}</dt>
                    <dd className="text-gray-700 text-right">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })}
      </div>
    </div>
  )
}
