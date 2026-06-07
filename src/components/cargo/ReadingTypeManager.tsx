'use client'

import { useState } from 'react'
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { type Voyage, type ReadingType } from '@/lib/cargo/types'
import { newId } from '@/lib/cargo/db'
import { holdNumbers } from '@/lib/cargo/periods'

interface Props {
  voyage: Voyage
  onChange: (next: Voyage) => void
}

export default function ReadingTypeManager({ voyage, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const holds = holdNumbers(voyage.holdCount)

  function update(types: ReadingType[]) {
    onChange({ ...voyage, readingTypes: types })
  }

  function patch(id: string, p: Partial<ReadingType>) {
    update(voyage.readingTypes.map(rt => (rt.id === id ? { ...rt, ...p } : rt)))
  }

  function addType() {
    const rt: ReadingType = {
      id: newId('rt'),
      name: 'New Reading',
      unit: '',
      appliesTo: 'all',
      includeInTables: true,
      includeInCharts: true,
      includeInPdf: true,
    }
    update([...voyage.readingTypes, rt])
    setExpanded(rt.id)
  }

  function removeType(id: string) {
    update(voyage.readingTypes.filter(rt => rt.id !== id))
  }

  function toggleHold(rt: ReadingType, hold: number) {
    const current = rt.appliesTo === 'all' ? [...holds] : [...rt.appliesTo]
    const next = current.includes(hold) ? current.filter(h => h !== hold) : [...current, hold].sort((a, b) => a - b)
    patch(rt.id, { appliesTo: next.length === holds.length ? 'all' : next })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Reading types are fully configurable — add gas, temperature, or client-specific readings without code changes.</p>
        <button onClick={addType} className="btn-secondary text-sm whitespace-nowrap"><Plus className="h-4 w-4" />Add Reading Type</button>
      </div>

      <div className="space-y-2">
        {voyage.readingTypes.map(rt => {
          const isOpen = expanded === rt.id
          return (
            <div key={rt.id} className="card p-0 overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <button onClick={() => setExpanded(isOpen ? null : rt.id)} className="text-gray-400 hover:text-gray-600">
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate">{rt.name}{rt.unit ? <span className="text-gray-400 font-normal"> ({rt.unit})</span> : null}</p>
                  <p className="text-xs text-gray-400">
                    {rt.appliesTo === 'all' ? 'All holds' : `Holds ${(rt.appliesTo as number[]).join(', ') || 'none'}`}
                    {' · '}
                    {[rt.includeInTables && 'Tables', rt.includeInCharts && 'Charts', rt.includeInPdf && 'PDF'].filter(Boolean).join(', ') || 'Hidden'}
                  </p>
                </div>
                <button onClick={() => removeType(rt.id)} className="text-gray-300 hover:text-red-500" title="Remove">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label-base">Reading Name</label>
                      <input className="input-base" value={rt.name} onChange={e => patch(rt.id, { name: e.target.value })} />
                    </div>
                    <div>
                      <label className="label-base">Unit</label>
                      <input className="input-base" value={rt.unit} onChange={e => patch(rt.id, { unit: e.target.value })} placeholder="°C, %, ppm…" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="label-base">Description</label>
                      <input className="input-base" value={rt.description ?? ''} onChange={e => patch(rt.id, { description: e.target.value })} placeholder="Optional" />
                    </div>
                  </div>

                  <div>
                    <label className="label-base">Applies to holds</label>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <button
                        onClick={() => patch(rt.id, { appliesTo: 'all' })}
                        className={`px-2.5 py-1 rounded text-xs font-medium border ${rt.appliesTo === 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                      >All</button>
                      {holds.map(h => {
                        const active = rt.appliesTo === 'all' || (rt.appliesTo as number[]).includes(h)
                        return (
                          <button
                            key={h}
                            onClick={() => toggleHold(rt, h)}
                            className={`px-2.5 py-1 rounded text-xs font-medium border ${active && rt.appliesTo !== 'all' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300'}`}
                          >{h}</button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-4">
                    {([['includeInTables', 'Include in tables'], ['includeInCharts', 'Include in charts'], ['includeInPdf', 'Include in PDF']] as const).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={rt[key]} onChange={e => patch(rt.id, { [key]: e.target.checked })} />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {voyage.readingTypes.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">No reading types yet. Add one to start.</p>
        )}
      </div>
    </div>
  )
}
