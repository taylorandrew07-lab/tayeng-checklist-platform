'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, Briefcase, Building2, Receipt } from 'lucide-react'
import { globalSearch, type SearchHit } from '@/lib/search/global'

const KIND_ICON: Record<SearchHit['kind'], React.ElementType> = {
  job: Briefcase, client: Building2, invoice: Receipt,
}

/** Top-bar quick search. Cmd/Ctrl+K to focus; arrow keys + Enter to navigate. */
export default function GlobalSearch({ role }: { role: string }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  // Debounced search.
  useEffect(() => {
    const t = q.trim()
    if (t.length < 2) { setHits([]); setLoading(false); return }
    setLoading(true)
    const h = setTimeout(async () => {
      const r = await globalSearch(t, role).catch(() => [])
      setHits(r); setActive(0); setLoading(false); setOpen(true)
    }, 250)
    return () => clearTimeout(h)
  }, [q, role])

  // Cmd/Ctrl+K focuses the search from anywhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const go = useCallback((hit: SearchHit) => {
    setOpen(false); setQ(''); setHits([]); router.push(hit.href)
  }, [router])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return }
    if (!hits.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const h = hits[active]; if (h) go(h) }
  }

  return (
    <div ref={boxRef} className="relative flex-1 max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => { if (hits.length) setOpen(true) }}
          onKeyDown={onKeyDown}
          placeholder="Search jobs, clients, invoices…"
          aria-label="Search"
          className="w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-9 py-2 text-sm focus:bg-white focus:border-brand-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        />
        {loading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="absolute left-0 right-0 mt-1.5 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-50 max-h-[70vh] overflow-y-auto">
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-400">{loading ? 'Searching…' : 'No matches.'}</p>
          ) : hits.map((h, i) => {
            const Icon = KIND_ICON[h.kind]
            return (
              <button
                key={`${h.kind}-${h.id}`}
                onMouseDown={(e) => { e.preventDefault(); go(h) }}
                onMouseEnter={() => setActive(i)}
                className={`w-full text-left flex items-center gap-3 px-3 py-2 ${i === active ? 'bg-brand-50' : 'hover:bg-gray-50'}`}
              >
                <Icon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-gray-900 truncate">{h.title}</span>
                  {h.subtitle && <span className="block text-xs text-gray-500 truncate">{h.subtitle}</span>}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-gray-300 flex-shrink-0">{h.kind}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
