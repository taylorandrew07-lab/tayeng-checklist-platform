'use client'

import { useState } from 'react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, ChevronDown, ChevronUp, Copy, GripVertical } from 'lucide-react'
import { type ReadingType, type ReadingPoint, SINGLE_POINT_ID } from '@/lib/cargo/types'
import { defaultColorRules } from '@/lib/cargo/colors'
import { newId } from '@/lib/cargo/db'
import { holdNumbers } from '@/lib/cargo/periods'

interface Props {
  readingTypes: ReadingType[]
  holdCount: number
  onChange: (types: ReadingType[]) => void
}

export default function ReadingTypeManager({ readingTypes, holdCount, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const holds = holdNumbers(holdCount)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function patch(id: string, p: Partial<ReadingType>) {
    onChange(readingTypes.map(rt => (rt.id === id ? { ...rt, ...p } : rt)))
  }

  function addType() {
    const rt: ReadingType = {
      id: newId('rt'), name: 'New Reading', unit: '', appliesTo: 'all',
      includeInTables: true, includeInCharts: true, includeInPdf: true,
      points: [{ id: SINGLE_POINT_ID, name: '' }],
    }
    onChange([...readingTypes, rt])
    setExpanded(rt.id)
  }

  function removeType(id: string) {
    onChange(readingTypes.filter(rt => rt.id !== id))
  }

  function duplicateType(rt: ReadingType) {
    const copy: ReadingType = {
      ...rt,
      id: newId('rt'),
      name: `${rt.name} (copy)`,
      builtIn: false,
      appliesTo: rt.appliesTo === 'all' ? 'all' : [...rt.appliesTo],
      points: rt.points.map(p => ({ ...p, id: newId('pt') })), // fresh ids so values stay independent
    }
    const idx = readingTypes.findIndex(t => t.id === rt.id)
    const next = [...readingTypes]
    next.splice(idx >= 0 ? idx + 1 : next.length, 0, copy)
    onChange(next)
    setExpanded(copy.id)
  }

  function toggleHold(rt: ReadingType, hold: number) {
    const current = rt.appliesTo === 'all' ? [...holds] : [...rt.appliesTo]
    const next = current.includes(hold) ? current.filter(h => h !== hold) : [...current, hold].sort((a, b) => a - b)
    patch(rt.id, { appliesTo: next.length === holds.length ? 'all' : next })
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = readingTypes.findIndex(rt => rt.id === active.id)
    const newIndex = readingTypes.findIndex(rt => rt.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onChange(arrayMove(readingTypes, oldIndex, newIndex))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Each reading type holds one or more named points (e.g. 21 thermocouples, 9 camera zones). Drag the handle to reorder.</p>
        <button onClick={addType} className="btn-secondary text-sm whitespace-nowrap"><Plus className="h-4 w-4" />Add Reading Type</button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={readingTypes.map(rt => rt.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {readingTypes.map(rt => (
              <SortableTypeCard
                key={rt.id}
                rt={rt}
                holds={holds}
                isOpen={expanded === rt.id}
                onToggleOpen={() => setExpanded(expanded === rt.id ? null : rt.id)}
                onPatch={patch}
                onRemove={removeType}
                onDuplicate={duplicateType}
                onToggleHold={toggleHold}
              />
            ))}
            {readingTypes.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">No reading types yet. Add one to start.</p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface CardProps {
  rt: ReadingType
  holds: number[]
  isOpen: boolean
  onToggleOpen: () => void
  onPatch: (id: string, p: Partial<ReadingType>) => void
  onRemove: (id: string) => void
  onDuplicate: (rt: ReadingType) => void
  onToggleHold: (rt: ReadingType, hold: number) => void
}

function SortableTypeCard({ rt, holds, isOpen, onToggleOpen, onPatch, onRemove, onDuplicate, onToggleHold }: CardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: rt.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const pointSummary = rt.points.length === 1 && !rt.points[0].name ? 'single value' : `${rt.points.length} point${rt.points.length !== 1 ? 's' : ''}`

  return (
    <div ref={setNodeRef} style={style} className="card p-0 overflow-hidden">
      <div className="flex items-center gap-2 p-3">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="text-gray-300 hover:text-gray-500 cursor-grab touch-none"
          title="Drag to reorder"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button onClick={onToggleOpen} className="text-gray-400 hover:text-gray-600">
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 truncate">{rt.name}{rt.unit ? <span className="text-gray-400 font-normal"> ({rt.unit})</span> : null}</p>
          <p className="text-xs text-gray-400">
            {pointSummary}
            {' · '}
            {rt.appliesTo === 'all' ? 'All holds' : `Holds ${(rt.appliesTo as number[]).join(', ') || 'none'}`}
            {' · '}
            {[rt.includeInTables && 'Tables', rt.includeInCharts && 'Charts', rt.includeInPdf && 'PDF'].filter(Boolean).join(', ') || 'Hidden'}
          </p>
        </div>
        <button onClick={() => onDuplicate(rt)} className="text-gray-300 hover:text-brand-600" title="Duplicate">
          <Copy className="h-4 w-4" />
        </button>
        <button onClick={() => onRemove(rt.id)} className="text-gray-300 hover:text-red-500" title="Remove">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label-base">Reading Name</label>
              <input className="input-base" value={rt.name} onChange={e => onPatch(rt.id, { name: e.target.value })} />
            </div>
            <div>
              <label className="label-base">Unit</label>
              <input className="input-base" value={rt.unit} onChange={e => onPatch(rt.id, { unit: e.target.value })} placeholder="°C, %, ppm…" />
            </div>
            <div className="sm:col-span-2">
              <label className="label-base">Description</label>
              <input className="input-base" value={rt.description ?? ''} onChange={e => onPatch(rt.id, { description: e.target.value })} placeholder="Optional" />
            </div>
          </div>

          <PointsEditor rt={rt} onChange={onPatch} />

          <div>
            <label className="label-base">Applies to holds</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              <button
                onClick={() => onPatch(rt.id, { appliesTo: 'all' })}
                className={`px-2.5 py-1 rounded text-xs font-medium border ${rt.appliesTo === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
              >All</button>
              {holds.map(h => {
                const active = rt.appliesTo === 'all' || (rt.appliesTo as number[]).includes(h)
                return (
                  <button
                    key={h}
                    onClick={() => onToggleHold(rt, h)}
                    className={`px-2.5 py-1 rounded text-xs font-medium border ${active && rt.appliesTo !== 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                  >{h}</button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            {([['includeInTables', 'Include in tables'], ['includeInCharts', 'Include in charts'], ['includeInPdf', 'Include in PDF']] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={rt[key]} onChange={e => onPatch(rt.id, { [key]: e.target.checked })} />
                {label}
              </label>
            ))}
          </div>

          <ColorRulesEditor rt={rt} onPatch={onPatch} />
        </div>
      )}
    </div>
  )
}

function ColorRulesEditor({ rt, onPatch }: { rt: ReadingType; onPatch: (id: string, p: Partial<ReadingType>) => void }) {
  const r = rt.colorRules
  const num = (v: string, fallback: number) => { const n = parseFloat(v); return Number.isFinite(n) ? n : fallback }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <input
          type="checkbox"
          checked={!!r}
          onChange={e => onPatch(rt.id, { colorRules: e.target.checked ? defaultColorRules() : undefined })}
        />
        Colour-code values by temperature rules
      </label>

      {r && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-gray-500 block">Amber at ≥ (°)</label>
              <input type="number" className="input-base py-1 text-sm" value={r.amber}
                onChange={e => onPatch(rt.id, { colorRules: { ...r, amber: num(e.target.value, r.amber) } })} />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block">Red at ≥ (°)</label>
              <input type="number" className="input-base py-1 text-sm" value={r.red}
                onChange={e => onPatch(rt.id, { colorRules: { ...r, red: num(e.target.value, r.red) } })} />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block">Daily rise → amber (°/24h)</label>
              <input type="number" className="input-base py-1 text-sm" value={r.rateDeltaC ?? 0}
                onChange={e => onPatch(rt.id, { colorRules: { ...r, rateDeltaC: num(e.target.value, 0) || undefined } })} />
            </div>
            <label className="flex items-end gap-2 text-sm text-gray-700 pb-1">
              <input type="checkbox" checked={!!r.gradient} onChange={e => onPatch(rt.id, { colorRules: { ...r, gradient: e.target.checked } })} />
              Gradient
            </label>
          </div>
          <p className="text-[11px] text-gray-400">
            Solid amber at ≥{r.amber}°, solid red at ≥{r.red}°. A rise of ≥{r.rateDeltaC ?? '—'}° vs the same period the day before turns the cell amber. Gradient blends green→amber for smaller daily rises.
          </p>
        </>
      )}
    </div>
  )
}

function PointsEditor({ rt, onChange }: { rt: ReadingType; onChange: (id: string, p: Partial<ReadingType>) => void }) {
  const [bulkCount, setBulkCount] = useState(10)
  const [bulkPrefix, setBulkPrefix] = useState('TC')

  const single = rt.points.length === 1 && !rt.points[0].name

  function setPoints(points: ReadingPoint[]) {
    // Never allow zero points — collapse to a single unnamed value instead.
    onChange(rt.id, { points: points.length ? points : [{ id: SINGLE_POINT_ID, name: '' }] })
  }
  function patchPoint(id: string, p: Partial<ReadingPoint>) {
    setPoints(rt.points.map(pt => (pt.id === id ? { ...pt, ...p } : pt)))
  }
  function addOne() {
    const named = rt.points.filter(p => p.name)
    setPoints([...named, { id: newId('pt'), name: `${bulkPrefix} ${named.length + 1}` }])
  }
  function addBulk() {
    const named = rt.points.filter(p => p.name)
    const start = named.length
    const extra = Array.from({ length: Math.max(1, bulkCount) }, (_, i) => ({ id: newId('pt'), name: `${bulkPrefix} ${start + i + 1}` }))
    setPoints([...named, ...extra])
  }
  function makeSingleValue() {
    setPoints([{ id: SINGLE_POINT_ID, name: '' }])
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="flex items-center justify-between">
        <label className="label-base mb-0">Points {single ? '(single value)' : `(${rt.points.length})`}</label>
        {!single && (
          <button onClick={makeSingleValue} className="text-xs text-gray-400 hover:text-gray-600">Make single value</button>
        )}
      </div>

      {!single && (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {rt.points.map((pt, i) => (
            <div key={pt.id} className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-5 text-right">{i + 1}</span>
              <input
                className="input-base py-1 text-sm flex-1"
                value={pt.name}
                onChange={e => patchPoint(pt.id, { name: e.target.value })}
                placeholder="Point name (e.g. TC 1)"
              />
              <input
                className="input-base py-1 text-sm w-24"
                value={pt.group ?? ''}
                onChange={e => patchPoint(pt.id, { group: e.target.value || undefined })}
                placeholder="Group"
              />
              <button onClick={() => setPoints(rt.points.filter(p => p.id !== pt.id))} className="text-gray-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 pt-1">
        <button onClick={addOne} className="btn-secondary py-1.5 px-3 text-xs"><Plus className="h-3.5 w-3.5" />Add point</button>
        <span className="text-gray-300">|</span>
        <div className="flex items-end gap-1.5">
          <div>
            <label className="text-[11px] text-gray-500 block">Bulk add</label>
            <input type="number" min={1} max={100} className="input-base py-1 text-sm w-16" value={bulkCount} onChange={e => setBulkCount(Number(e.target.value))} />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 block">named</label>
            <input className="input-base py-1 text-sm w-20" value={bulkPrefix} onChange={e => setBulkPrefix(e.target.value)} placeholder="TC" />
          </div>
          <button onClick={addBulk} className="btn-secondary py-1.5 px-3 text-xs">Add {Math.max(1, bulkCount)}</button>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">Bulk add appends points named &ldquo;{bulkPrefix || 'Point'} 1, {bulkPrefix || 'Point'} 2&hellip;&rdquo;. Set a Group (e.g. BTM, LVL 1, TOP) on each point to organise tables.</p>
    </div>
  )
}
