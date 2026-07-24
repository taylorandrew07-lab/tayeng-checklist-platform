'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Trophy, Medal, Star, Loader2, Check, Eye, EyeOff, ImageOff,
} from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { cn, formatDate } from '@/lib/utils'
import {
  currentCompetitionMonth, monthLabel, listMonthSummaries, adminListEntries,
  myOwnEntryIds, withUrls, getRound, saveRound, savePlacements,
  type MonthSummary,
} from '@/lib/competition/api'
import type { CompetitionRound, EntryWithUrl, RoundStatus } from '@/lib/competition/types'
import { EntryThumb, EntryLightbox } from './media'

export default function Judging() {
  const [months, setMonths] = useState<MonthSummary[]>([])
  const [month, setMonth] = useState<string>(currentCompetitionMonth())
  const [entries, setEntries] = useState<EntryWithUrl[]>([])
  const [round, setRound] = useState<CompetitionRound | null>(null)
  const [loading, setLoading] = useState(true)

  const [winnerId, setWinnerId] = useState<string | null>(null)
  const [runnerUpId, setRunnerUpId] = useState<string | null>(null)
  const [shortlist, setShortlist] = useState<Set<string>>(new Set())
  const [shortlistOnly, setShortlistOnly] = useState(false)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const loadMonth = useCallback(async (m: string) => {
    setLoading(true)
    const [rows, mine, r] = await Promise.all([adminListEntries(m), myOwnEntryIds(), getRound(m)])
    const withMine = rows.map(e => ({ ...e, mine: mine.has(e.id) }))
    const signed = await withUrls(withMine)
    setEntries(signed.map((e, i) => ({ ...e, mine: withMine[i].mine })))
    setRound(r)
    setWinnerId(rows.find(e => e.placement === 'winner')?.id ?? null)
    setRunnerUpId(rows.find(e => e.placement === 'runner_up')?.id ?? null)
    setShortlist(new Set())
    setShortlistOnly(false)
    setLightboxIdx(null)
    setLoading(false)
  }, [])

  useEffect(() => { listMonthSummaries().then(setMonths).catch(() => {}) }, [])
  useEffect(() => { loadMonth(month) }, [month, loadMonth])

  const visible = useMemo(
    () => (shortlistOnly ? entries.filter(e => shortlist.has(e.id)) : entries),
    [entries, shortlistOnly, shortlist],
  )

  function pickWinner(id: string) {
    setWinnerId(prev => (prev === id ? null : id))
    setRunnerUpId(prev => (prev === id ? null : prev))
  }
  function pickRunnerUp(id: string) {
    setRunnerUpId(prev => (prev === id ? null : id))
    setWinnerId(prev => (prev === id ? null : prev))
  }
  function toggleShortlist(id: string) {
    setShortlist(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // Judging keyboard shortcuts while the lightbox is open: W / R / S.
  useEffect(() => {
    if (lightboxIdx == null) return
    const entry = visible[lightboxIdx]
    if (!entry) return
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'w') { e.preventDefault(); pickWinner(entry.id) }
      else if (k === 'r') { e.preventDefault(); pickRunnerUp(entry.id) }
      else if (k === 's') { e.preventDefault(); toggleShortlist(entry.id) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxIdx, visible])

  async function save() {
    setSaving(true); setMsg(null)
    const res = await savePlacements(month, { winnerId, runnerUpId })
    setSaving(false)
    if (res.error) { setMsg(res.error); return }
    setMsg(winnerId ? 'Results saved — winner and runner-up have been notified.' : 'Results cleared.')
    await loadMonth(month)
    listMonthSummaries().then(setMonths).catch(() => {})
  }

  const closed = round?.status === 'closed'
  const preview = lightboxIdx != null ? visible[lightboxIdx] : null

  return (
    <div className="space-y-5">
      {/* Controls: month + theme + status */}
      <div className="card space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label-base">Month</label>
            <select className="input-base" value={month} onChange={e => setMonth(e.target.value)}>
              {(months.some(m => m.month === month) ? months : [{ month, entries: entries.length, judged: false, status: 'open' as RoundStatus }, ...months])
                .map(m => (
                  <option key={m.month} value={m.month}>
                    {monthLabel(m.month)} · {m.entries} {m.entries === 1 ? 'entry' : 'entries'}{m.judged ? ' · judged' : ''}
                  </option>
                ))}
            </select>
          </div>
          <RoundControls round={round} month={month} onSaved={setRound} />
        </div>
        <p className="flex items-center gap-1.5 text-sm text-gray-500">
          <EyeOff className="h-3.5 w-3.5 shrink-0" />
          Blind judging — entrant names are hidden here, and only this month’s photos are shown. Your own submissions are flagged so you can recuse.
        </p>
      </div>

      {/* Toolbar */}
      {!loading && entries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="inline-flex items-center gap-1"><Trophy className="h-4 w-4 text-brand-600" /> {winnerId ? '1' : '0'} winner</span>
            <span className="text-gray-300">·</span>
            <span className="inline-flex items-center gap-1"><Medal className="h-4 w-4 text-gray-500" /> {runnerUpId ? '1' : '0'} runner-up</span>
            {shortlist.size > 0 && <><span className="text-gray-300">·</span><span className="inline-flex items-center gap-1"><Star className="h-4 w-4 text-amber-500" /> {shortlist.size} shortlisted</span></>}
          </div>
          <div className="flex items-center gap-2">
            {shortlist.size > 0 && (
              <button className={cn('btn-ghost', shortlistOnly && 'text-brand-700')} onClick={() => setShortlistOnly(v => !v)}>
                {shortlistOnly ? <Eye className="h-4 w-4" /> : <Star className="h-4 w-4" />} {shortlistOnly ? 'Show all' : 'Shortlisted only'}
              </button>
            )}
            <button className="btn-primary" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {closed ? 'Update results' : 'Save results'}
            </button>
          </div>
        </div>
      )}
      {msg && <p className="text-sm text-brand-700">{msg}</p>}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton aspect-square rounded-lg" />)}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={ImageOff} title="No entries for this month" description="When staff submit photos this month, they’ll appear here for judging." />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((e, i) => {
            const isWinner = winnerId === e.id
            const isRunner = runnerUpId === e.id
            const isShort = shortlist.has(e.id)
            return (
              <EntryThumb
                key={e.id}
                entry={e}
                onClick={() => setLightboxIdx(i)}
                className={cn((isWinner || isRunner) && 'ring-2 ring-offset-2', isWinner && 'ring-brand-600', isRunner && 'ring-gray-400')}
                overlay={
                  <>
                    <div className="pointer-events-none absolute left-1.5 top-1.5 flex flex-wrap gap-1">
                      {isWinner && <span className="inline-flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white"><Trophy className="h-3 w-3" />Winner</span>}
                      {isRunner && <span className="inline-flex items-center gap-1 rounded-full bg-gray-800 px-2 py-0.5 text-[11px] font-semibold text-white"><Medal className="h-3 w-3" />Runner-up</span>}
                      {isShort && !isWinner && !isRunner && <span className="inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950"><Star className="h-3 w-3" /></span>}
                      {e.mine && <span className="inline-flex items-center rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Yours</span>}
                    </div>
                  </>
                }
              />
            )
          })}
        </div>
      )}

      <EntryLightbox
        entry={preview}
        onClose={() => setLightboxIdx(null)}
        onPrev={preview && lightboxIdx! > 0 ? () => setLightboxIdx(lightboxIdx! - 1) : undefined}
        onNext={preview && lightboxIdx! < visible.length - 1 ? () => setLightboxIdx(lightboxIdx! + 1) : undefined}
        footer={preview && (
          <div className="space-y-2">
            {preview.mine && <p className="text-xs text-amber-300">This is your own submission — consider recusing.</p>}
            {preview.captured_at && <p className="text-xs text-white/60">Taken {formatDate(preview.captured_at)}</p>}
            <div className="flex items-center justify-center gap-2">
              <button onClick={() => pickWinner(preview.id)} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', winnerId === preview.id ? 'bg-brand-600 text-white' : 'bg-white/15 text-white hover:bg-white/25')}>
                <Trophy className="mr-1 inline h-4 w-4" />Winner <kbd className="ml-1 opacity-60">W</kbd>
              </button>
              <button onClick={() => pickRunnerUp(preview.id)} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', runnerUpId === preview.id ? 'bg-gray-200 text-gray-900' : 'bg-white/15 text-white hover:bg-white/25')}>
                <Medal className="mr-1 inline h-4 w-4" />Runner-up <kbd className="ml-1 opacity-60">R</kbd>
              </button>
              <button onClick={() => toggleShortlist(preview.id)} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', shortlist.has(preview.id) ? 'bg-amber-400 text-amber-950' : 'bg-white/15 text-white hover:bg-white/25')}>
                <Star className="mr-1 inline h-4 w-4" />Shortlist <kbd className="ml-1 opacity-60">S</kbd>
              </button>
            </div>
          </div>
        )}
      />
    </div>
  )
}

function RoundControls({ round, month, onSaved }: { round: CompetitionRound | null; month: string; onSaved: (r: CompetitionRound) => void }) {
  const [theme, setTheme] = useState(round?.theme ?? '')
  const [status, setStatus] = useState<RoundStatus>(round?.status ?? 'open')
  const [saving, setSaving] = useState(false)
  // Key on `month` (always changes on switch) as well — two round-less months
  // both give round===null, so syncing on round?.* alone would keep a typed-but-
  // unsaved theme when moving between them and could save it to the wrong month.
  useEffect(() => { setTheme(round?.theme ?? ''); setStatus(round?.status ?? 'open') }, [month, round?.theme, round?.status])

  async function save() {
    setSaving(true)
    const res = await saveRound(month, { theme, status })
    setSaving(false)
    if (!res.error) onSaved({ month, theme: theme.trim() || null, status, closed_at: status === 'closed' ? new Date().toISOString() : null, created_at: round?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() })
  }

  return (
    <>
      <div className="min-w-[12rem] flex-1">
        <label className="label-base">Theme (optional)</label>
        <input className="input-base" value={theme} onChange={e => setTheme(e.target.value)} placeholder="e.g. Safety in action" />
      </div>
      <div>
        <label className="label-base">Status</label>
        <select className="input-base" value={status} onChange={e => setStatus(e.target.value as RoundStatus)}>
          <option value="open">Open</option>
          <option value="judging">Judging</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <button className="btn-secondary" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
      </button>
    </>
  )
}
