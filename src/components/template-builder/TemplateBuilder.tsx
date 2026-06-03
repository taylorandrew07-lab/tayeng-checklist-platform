'use client'

import { useState, Fragment } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Plus,
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import FieldEditor from './FieldEditor'
import { createBlankField, createBlankSection } from './types'
import type { BuilderSection, BuilderField } from './types'
import { cn } from '@/lib/utils'

interface TemplateBuilderProps {
  sections: BuilderSection[]
  onChange: (sections: BuilderSection[]) => void
}

// Re-stamp order_index and the auto sequential item_number for a section's fields.
// Layout fields (heading/divider) are skipped in the visible numbering.
function renumberFields(fields: BuilderField[]): BuilderField[] {
  let n = 0
  return fields.map((f, i) => {
    const isLayout = f.field_type === 'heading' || f.field_type === 'divider'
    return { ...f, order_index: i, item_number: isLayout ? '' : String(++n) }
  })
}

// Visible number for a field at render time (skips layout fields). Returns '' for layout.
function computeDisplayNumber(fields: BuilderField[], index: number): string {
  let n = 0
  for (let i = 0; i <= index; i++) {
    const isLayout = fields[i].field_type === 'heading' || fields[i].field_type === 'divider'
    if (!isLayout) n++
    if (i === index) return isLayout ? '' : String(n)
  }
  return ''
}

// The same-section field a field's visibility depends on (its logical parent).
function parentOf(field: BuilderField, sectionFieldIds: Set<string>): string | undefined {
  return field.conditional_logic?.conditions?.find(c => sectionFieldIds.has(c.field_id))?.field_id
}

// Nesting depth of each field within a section (0 = top level), from the
// conditional-logic parent chain. Cycle-safe.
function computeDepths(fields: BuilderField[]): Map<string, number> {
  const byId = new Map(fields.map(f => [f.id, f] as const))
  const ids = new Set(fields.map(f => f.id))
  const memo = new Map<string, number>()
  function depthOf(f: BuilderField, stack: Set<string>): number {
    const cached = memo.get(f.id)
    if (cached !== undefined) return cached
    const pid = parentOf(f, ids)
    const parent = pid ? byId.get(pid) : undefined
    let d = 0
    if (parent && !stack.has(f.id)) {
      stack.add(f.id)
      d = 1 + depthOf(parent, stack)
      stack.delete(f.id)
    }
    memo.set(f.id, d)
    return d
  }
  for (const f of fields) depthOf(f, new Set())
  return memo
}

// Is `field` somewhere in the subtree beneath `ancestorId`?
function isDescendantOf(
  field: BuilderField,
  ancestorId: string,
  byId: Map<string, BuilderField>,
  ids: Set<string>,
  stack = new Set<string>()
): boolean {
  const pid = parentOf(field, ids)
  if (!pid || stack.has(field.id)) return false
  if (pid === ancestorId) return true
  stack.add(field.id)
  const parent = byId.get(pid)
  return parent ? isDescendantOf(parent, ancestorId, byId, ids, stack) : false
}

// A sensible default trigger value when creating a follow-up.
function defaultTriggerValue(parent: BuilderField): string {
  if (parent.field_type === 'yes_no' || parent.field_type === 'yes_no_na') return 'no'
  if (parent.field_type === 'dropdown') return parent.options[0]?.value ?? ''
  return ''
}

export default function TemplateBuilder({ sections, onChange }: TemplateBuilderProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const allFields = sections.flatMap(s => s.fields)

  function addSection() {
    const newSection = createBlankSection(sections.length)
    onChange([...sections, newSection])
  }

  function updateSection(id: string, patch: Partial<BuilderSection>) {
    onChange(sections.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  function deleteSection(id: string) {
    onChange(sections.filter(s => s.id !== id))
  }

  // Insert a new blank field at the given position within the section
  function addFieldAt(sectionId: string, atIndex: number) {
    onChange(sections.map(s => {
      if (s.id !== sectionId) return s
      const newField = createBlankField(atIndex)
      const updated = renumberFields([
        ...s.fields.slice(0, atIndex),
        newField,
        ...s.fields.slice(atIndex),
      ])
      return { ...s, fields: updated }
    }))
  }

  function updateField(sectionId: string, fieldId: string, field: BuilderField) {
    onChange(sections.map(s => {
      if (s.id !== sectionId) return s
      // renumber so a field-type change to/from a layout type re-flows the sequence
      return { ...s, fields: renumberFields(s.fields.map(f => f.id === fieldId ? field : f)) }
    }))
  }

  function deleteField(sectionId: string, fieldId: string) {
    onChange(sections.map(s => {
      if (s.id !== sectionId) return s
      return { ...s, fields: renumberFields(s.fields.filter(f => f.id !== fieldId)) }
    }))
  }

  // Add a conditional follow-up question under a parent: a new field placed
  // right after the parent (and any existing follow-ups), with its visibility
  // wired to the parent's answer via the existing conditional_logic engine.
  function addFollowUp(sectionId: string, parentFieldId: string) {
    onChange(sections.map(s => {
      if (s.id !== sectionId) return s
      const parentIndex = s.fields.findIndex(f => f.id === parentFieldId)
      if (parentIndex === -1) return s
      const parent = s.fields[parentIndex]
      const byId = new Map(s.fields.map(f => [f.id, f] as const))
      const ids = new Set(s.fields.map(f => f.id))
      let insertAt = parentIndex + 1
      while (insertAt < s.fields.length && isDescendantOf(s.fields[insertAt], parentFieldId, byId, ids)) insertAt++
      const child = createBlankField(insertAt, 'text')
      child.label = 'Follow-up question'
      child.conditional_logic = {
        operator: 'and',
        conditions: [{ field_id: parentFieldId, operator: 'equals', value: defaultTriggerValue(parent) }],
      }
      const updated = renumberFields([
        ...s.fields.slice(0, insertAt),
        child,
        ...s.fields.slice(insertAt),
      ])
      return { ...s, fields: updated }
    }))
  }

  function handleSectionDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = sections.findIndex(s => s.id === active.id)
    const newIndex = sections.findIndex(s => s.id === over.id)
    const reordered = arrayMove(sections, oldIndex, newIndex).map((s, i) => ({ ...s, order_index: i }))
    onChange(reordered)
  }

  function handleFieldDragEnd(sectionId: string, event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onChange(sections.map(s => {
      if (s.id !== sectionId) return s
      const oldIndex = s.fields.findIndex(f => f.id === active.id)
      const newIndex = s.fields.findIndex(f => f.id === over.id)
      const reordered = renumberFields(arrayMove(s.fields, oldIndex, newIndex))
      return { ...s, fields: reordered }
    }))
  }

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext
          items={sections.map(s => s.id)}
          strategy={verticalListSortingStrategy}
        >
          {sections.map((section) => (
            <SortableSection
              key={section.id}
              section={section}
              allFields={allFields}
              onUpdate={(patch) => updateSection(section.id, patch)}
              onDelete={() => deleteSection(section.id)}
              onAddFieldAt={(atIndex) => addFieldAt(section.id, atIndex)}
              onUpdateField={(fieldId, field) => updateField(section.id, fieldId, field)}
              onDeleteField={(fieldId) => deleteField(section.id, fieldId)}
              onFieldDragEnd={(event) => handleFieldDragEnd(section.id, event)}
              onAddFollowUp={(fieldId) => addFollowUp(section.id, fieldId)}
            />
          ))}
        </SortableContext>
      </DndContext>

      <button
        type="button"
        onClick={addSection}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl py-4 text-sm text-gray-500 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-colors flex items-center justify-center gap-2"
      >
        <Plus className="h-4 w-4" />
        Add Section
      </button>
    </div>
  )
}

// Thin insert-field button rendered between fields
function InsertFieldButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex items-center gap-2 my-1 group/insert">
      <div className="flex-1 h-px border-t border-dashed border-gray-200 group-hover/insert:border-brand-300 transition-colors" />
      <button
        type="button"
        onClick={onClick}
        title="Insert field here"
        className="w-5 h-5 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50 transition-colors flex-shrink-0 shadow-sm"
      >
        <Plus className="h-3 w-3" />
      </button>
      <div className="flex-1 h-px border-t border-dashed border-gray-200 group-hover/insert:border-brand-300 transition-colors" />
    </div>
  )
}

interface SortableSectionProps {
  section: BuilderSection
  allFields: BuilderField[]
  onUpdate: (patch: Partial<BuilderSection>) => void
  onDelete: () => void
  onAddFieldAt: (atIndex: number) => void
  onUpdateField: (fieldId: string, field: BuilderField) => void
  onDeleteField: (fieldId: string) => void
  onFieldDragEnd: (event: DragEndEvent) => void
  onAddFollowUp: (fieldId: string) => void
}

function SortableSection({
  section,
  allFields,
  onUpdate,
  onDelete,
  onAddFieldAt,
  onUpdateField,
  onDeleteField,
  onFieldDragEnd,
  onAddFollowUp,
}: SortableSectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  const depths = computeDepths(section.fields)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.id })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="card overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
        {/* Fix #2: use inline style for grab cursor so it's never overridden */}
        <button
          type="button"
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          className="text-gray-400 hover:text-gray-600 touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" />
        </button>

        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={section.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="text-sm font-semibold text-gray-900 bg-transparent border-none outline-none w-full"
            placeholder="Section Title"
          />
          <input
            type="text"
            value={section.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            className="text-xs text-gray-500 bg-transparent border-none outline-none w-full mt-0.5"
            placeholder="Optional section description"
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="hidden sm:inline text-xs text-gray-400">{section.fields.length} field{section.fields.length !== 1 ? 's' : ''}</span>
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="p-1.5 rounded text-red-400 hover:text-red-600 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4">
          {section.fields.length === 0 ? (
            <>
              <p className="text-sm text-gray-400 italic text-center py-3">
                No fields yet — click below to add your first field.
              </p>
              <InsertFieldButton onClick={() => onAddFieldAt(0)} />
            </>
          ) : (
            <>
              {/* Top insert button */}
              <InsertFieldButton onClick={() => onAddFieldAt(0)} />

              {/* Fields with insert buttons between each pair */}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onFieldDragEnd}
              >
                <SortableContext
                  items={section.fields.map(f => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {section.fields.map((field, i) => {
                    const depth = depths.get(field.id) ?? 0
                    const isLayout = field.field_type === 'heading' || field.field_type === 'divider'
                    return (
                      <Fragment key={field.id}>
                        <div
                          style={depth > 0 ? { marginLeft: Math.min(depth, 5) * 16 } : undefined}
                          className={depth > 0 ? 'border-l-2 border-amber-200 pl-3' : ''}
                        >
                          <SortableField
                            field={field}
                            sections={[]}
                            allFields={allFields}
                            displayNumber={computeDisplayNumber(section.fields, i)}
                            onUpdate={(updated) => onUpdateField(field.id, updated)}
                            onDelete={() => onDeleteField(field.id)}
                          />
                          {!isLayout && (
                            <button
                              type="button"
                              onClick={() => onAddFollowUp(field.id)}
                              className="ml-7 -mt-1 mb-1 text-xs text-amber-700 hover:text-amber-800 inline-flex items-center gap-1"
                            >
                              <Plus className="h-3 w-3" />Add follow-up question
                            </button>
                          )}
                        </div>
                        <InsertFieldButton onClick={() => onAddFieldAt(i + 1)} />
                      </Fragment>
                    )
                  })}
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
      )}
    </div>
  )
}

interface SortableFieldProps {
  field: BuilderField
  sections: BuilderSection[]
  allFields: BuilderField[]
  displayNumber: string
  onUpdate: (field: BuilderField) => void
  onDelete: () => void
}

function SortableField({ field, sections, allFields, displayNumber, onUpdate, onDelete }: SortableFieldProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 mb-3">
      {/* Fix #2: inline style cursor, slightly darker icon for visibility */}
      <button
        type="button"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        className="mt-3 text-gray-400 hover:text-gray-600 touch-none flex-shrink-0"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        <FieldEditor
          field={field}
          sections={sections}
          allFields={allFields}
          displayNumber={displayNumber}
          onChange={onUpdate}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
