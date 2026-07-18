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
import { applyItemNumbering, itemNumberFor } from '@/lib/checklist/itemNumbering'
import {
  Plus,
  GripVertical,
  Trash2,
  ChevronDown,
  ChevronUp,
  Type,
  Hash,
  AlignLeft,
  Calendar,
  Clock,
  List,
  CheckSquare,
  Calculator,
  Image as ImageIcon,
  Video,
  User,
  PenLine,
  Heading1,
  Minus,
} from 'lucide-react'
import FieldEditor from './FieldEditor'
import { createBlankField, createBlankSection } from './types'
import type { BuilderSection, BuilderField } from './types'
import type { FieldType, FieldOption } from '@/lib/types/database'
import { cn } from '@/lib/utils'

// iAuditor-style "type of response" chip: a small icon + label per field type, with
// option previews for choice fields. Keeps the builder readable at a glance.
const TYPE_META: Record<string, { icon: typeof Type; label: string; color: string }> = {
  text: { icon: Type, label: 'Text answer', color: 'text-orange-500' },
  textarea: { icon: AlignLeft, label: 'Long text', color: 'text-orange-500' },
  number: { icon: Hash, label: 'Number', color: 'text-emerald-500' },
  date: { icon: Calendar, label: 'Date', color: 'text-sky-500' },
  time: { icon: Clock, label: 'Time', color: 'text-sky-500' },
  dropdown: { icon: List, label: 'Dropdown', color: 'text-violet-500' },
  yes_no: { icon: CheckSquare, label: 'Yes / No', color: 'text-violet-500' },
  yes_no_na: { icon: CheckSquare, label: 'Yes / No / N/A', color: 'text-violet-500' },
  pass_fail: { icon: CheckSquare, label: 'Pass / Fail', color: 'text-violet-500' },
  multiple_choice: { icon: CheckSquare, label: 'Multiple choice', color: 'text-violet-500' },
  calculated: { icon: Calculator, label: 'Calculated', color: 'text-blue-500' },
  photo: { icon: ImageIcon, label: 'Media', color: 'text-cyan-500' },
  video_link: { icon: Video, label: 'Video link', color: 'text-cyan-500' },
  client_select: { icon: User, label: 'Client', color: 'text-orange-500' },
  signature: { icon: PenLine, label: 'Signature', color: 'text-rose-500' },
  heading: { icon: Heading1, label: 'Section heading', color: 'text-gray-400' },
  divider: { icon: Minus, label: 'Divider', color: 'text-gray-400' },
}

function TypeChip({ type, options }: { type: FieldType; options?: FieldOption[] }) {
  if ((type === 'multiple_choice' || type === 'dropdown') && options && options.length > 0) {
    return (
      <span className="flex items-center gap-1 flex-shrink-0">
        {options.slice(0, 2).map((o, i) => (
          <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 whitespace-nowrap max-w-[7rem] truncate">{o.label}</span>
        ))}
        {options.length > 2 && <span className="text-[11px] text-gray-400">+{options.length - 2}</span>}
      </span>
    )
  }
  const meta = TYPE_META[type] ?? { icon: Type, label: type, color: 'text-gray-400' }
  const Icon = meta.icon
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 flex-shrink-0">
      <Icon className={cn('h-3.5 w-3.5', meta.color)} />
      {meta.label}
    </span>
  )
}

interface TemplateBuilderProps {
  sections: BuilderSection[]
  onChange: (sections: BuilderSection[]) => void
  /**
   * Keep hand-authored item numbers ("1A", "6B") instead of auto-numbering each section 1..n.
   * Set for templates transcribed from a paper form — see lib/checklist/itemNumbering.
   */
  manualNumbering?: boolean
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
  if (parent.field_type === 'pass_fail') return 'fail'
  if (parent.field_type === 'dropdown' || parent.field_type === 'multiple_choice') return parent.options[0]?.value ?? ''
  return ''
}

export default function TemplateBuilder({ sections, onChange, manualNumbering = false }: TemplateBuilderProps) {
  // Re-stamp order_index and (unless the template numbers by hand) the sequential item_number.
  const renumberFields = (fields: BuilderField[]) => applyItemNumbering(fields, manualNumbering)
  const computeDisplayNumber = (fields: BuilderField[], index: number) =>
    itemNumberFor(fields, index, manualNumbering)

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
    // "Billable hours" is one-per-template: turning it on here clears it everywhere
    // else, so the Ops panel and the invoice can never read two different fields.
    const single = field.is_billable_hours === true
    onChange(sections.map(s => {
      if (s.id === sectionId) {
        let fields = s.fields.map(f => f.id === fieldId ? field : f)
        if (single) fields = fields.map(f => (f.id !== fieldId && f.is_billable_hours) ? { ...f, is_billable_hours: false } : f)
        // renumber so a field-type change to/from a layout type re-flows the sequence
        return { ...s, fields: renumberFields(fields) }
      }
      if (single) return { ...s, fields: s.fields.map(f => f.is_billable_hours ? { ...f, is_billable_hours: false } : f) }
      return s
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
              manualNumbering={manualNumbering}
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
  manualNumbering: boolean
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
  manualNumbering,
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

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-medium text-gray-600 cursor-pointer select-none" title="Let the surveyor add many entries of this section — one per line/inspection">
            <input
              type="checkbox"
              checked={section.is_repeatable}
              onChange={(e) => onUpdate({ is_repeatable: e.target.checked })}
              className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            Repeat this section
          </label>
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
              {/* Column header, iAuditor-style */}
              <div className="flex items-center justify-between gap-3 pl-9 pr-3 pb-1.5 mb-1 border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                <span>Question</span>
                <span>Type of response</span>
              </div>

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
                            allFields={allFields}
                            displayNumber={itemNumberFor(section.fields, i, manualNumbering)}
                            manualNumbering={manualNumbering}
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
  allFields: BuilderField[]
  displayNumber: string
  manualNumbering: boolean
  onUpdate: (field: BuilderField) => void
  onDelete: () => void
}

function SortableField({ field, allFields, displayNumber, manualNumbering, onUpdate, onDelete }: SortableFieldProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })

  // Compact, iAuditor-style row by default; expand to the full editor on click. A
  // freshly-added field (still the placeholder label) opens expanded so it's editable.
  const isPlaceholder = field.label === 'New Field' || field.label === 'Follow-up question' || field.label.trim() === ''
  const [collapsed, setCollapsed] = useState(!isPlaceholder)

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex gap-2 mb-2">
      <button
        type="button"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        className={cn('text-gray-400 hover:text-gray-600 touch-none flex-shrink-0', collapsed ? 'mt-2' : 'mt-3')}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0">
        {collapsed ? (
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-200 hover:border-brand-300 hover:bg-brand-50/40 transition-colors text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              {displayNumber && <span className="text-brand-600 font-semibold text-xs flex-shrink-0">{displayNumber}</span>}
              {field.is_required && <span className="text-red-500 flex-shrink-0">*</span>}
              <span className="text-sm text-gray-800 truncate">{field.label || 'Untitled question'}</span>
            </span>
            <TypeChip type={field.field_type} options={field.options} />
          </button>
        ) : (
          <div>
            <FieldEditor
              field={field}
              allFields={allFields}
              displayNumber={displayNumber}
              manualNumbering={manualNumbering}
              onChange={onUpdate}
              onDelete={onDelete}
            />
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              className="mt-1 text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1"
            >
              <ChevronUp className="h-3 w-3" /> Collapse
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
