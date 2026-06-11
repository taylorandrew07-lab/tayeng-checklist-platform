'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

/**
 * Live-refresh signal for dashboards. Subscribes to Supabase Realtime
 * (postgres_changes) on a table and returns a counter that increments whenever a
 * relevant row changes — so a list can re-run its existing fetch (which re-applies
 * RLS, the authoritative visibility check). Realtime only delivers rows the user
 * can already SELECT, so this never leaks data.
 *
 * Safety nets: also bumps on tab focus, and (if Realtime is unavailable) a 60s
 * poll while the tab is visible. Tears everything down on unmount / while offline.
 *
 * Usage:
 *   const tick = useRealtimeRefresh('jobs')
 *   useEffect(() => { load() }, [tick])
 */
export function useRealtimeRefresh(table: string): number {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const supabase = createClient()
    let debounce: ReturnType<typeof setTimeout> | null = null
    const bump = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => setTick(t => t + 1), 400)
    }

    let realtimeOk = false
    const channel = supabase
      .channel(`rt-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, bump)
      .subscribe(status => { if (status === 'SUBSCRIBED') realtimeOk = true })

    // Refetch when the tab regains focus (covers missed events + offline→online).
    const onVisible = () => { if (document.visibilityState === 'visible') bump() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', bump)

    // Fallback poll only if Realtime never connected (and only while visible/online).
    const poll = setInterval(() => {
      if (!realtimeOk && document.visibilityState === 'visible' && navigator.onLine) bump()
    }, 60_000)

    return () => {
      if (debounce) clearTimeout(debounce)
      clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', bump)
      supabase.removeChannel(channel)
    }
  }, [table])

  return tick
}
