'use client'

// The drag-to-reorder layer for the sidebar nav. Split into its own module and
// loaded on demand (only when the user enters "Customize menu") so @dnd-kit —
// ~tens of KB that would otherwise ship on every dashboard page — stays out of
// the initial bundle. Normal navigation never downloads it.

import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import type { NavItem } from './Sidebar'

export default function SidebarReorder({ order, onReorder }: { order: NavItem[]; onReorder: (next: NavItem[]) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = order.findIndex(i => i.href === active.id)
    const newIndex = order.findIndex(i => i.href === over.id)
    onReorder(arrayMove(order, oldIndex, newIndex))
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={order.map(i => i.href)} strategy={verticalListSortingStrategy}>
        {order.map(item => <SortableNavItem key={item.href} item={item} />)}
      </SortableContext>
    </DndContext>
  )
}

function SortableNavItem({ item }: { item: NavItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.href })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-brand-100 bg-brand-800/70 cursor-grab touch-none select-none"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4 text-brand-400 flex-shrink-0" />
      <item.icon className="h-5 w-5 flex-shrink-0 text-brand-300" />
      {item.label}
    </div>
  )
}
