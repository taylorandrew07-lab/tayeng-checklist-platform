'use client'

import { useEffect, useRef, useState } from 'react'
import { RefreshCw, Share, X, HardDrive } from 'lucide-react'
import { dirtyState } from '@/lib/dirty-state'

/**
 * Registers the offline service worker for staff and surfaces three field-friendly
 * PWA prompts: "update available — reload", an iOS "Add to Home Screen" hint (for
 * stronger storage persistence), and a storage-almost-full warning. When `enabled`
 * is false (e.g. a client on a shared device) it unregisters any worker and clears
 * our caches, and shows nothing.
 */
export default function ServiceWorkerRegister({ enabled }: { enabled: boolean }) {
  const [updateReady, setUpdateReady] = useState(false)
  const [iosHint, setIosHint] = useState(false)
  const [quotaWarn, setQuotaWarn] = useState(false)
  const regRef = useRef<ServiceWorkerRegistration | null>(null)
  const reloadedRef = useRef(false)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    if (!enabled) {
      navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {})
      if (typeof caches !== 'undefined') {
        caches.keys().then(keys => keys.filter(k => k.startsWith('tayeng-')).forEach(k => caches.delete(k))).catch(() => {})
      }
      return
    }

    // Refresh onto the new version automatically — but NEVER while the surveyor has
    // unsaved checklist edits or the app is backgrounded. In those cases the banner
    // waits and it auto-applies the moment they're idle (e.g. after they submit).
    // This is what stops surveyors running a stale app (the cause of submit issues)
    // without anyone deleting/reinstalling.
    const applyUpdate = () => {
      if (reloadedRef.current) return
      if (dirtyState.isDirty) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      reloadedRef.current = true
      window.location.reload()
    }

    const watch = (reg: ServiceWorkerRegistration) => {
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing
        if (!sw) return
        sw.addEventListener('statechange', () => {
          // A new worker finished installing while an old one controls the page → update available.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) { setUpdateReady(true); applyUpdate() }
        })
      })
    }

    const register = () => {
      navigator.serviceWorker.register('/sw.js').then(reg => {
        regRef.current = reg
        watch(reg)
        reg.update().catch(() => {})
      }).catch(() => {})
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })

    // A long-open PWA never reloads on its own, so it can sit on a stale version for
    // a day+. Poll for a new one when the app regains focus and every 15 min, then
    // apply it when safe. This closes the staleness window with no manual reinstall.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      regRef.current?.update().catch(() => {})
      applyUpdate()
    }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => { regRef.current?.update().catch(() => {}) }, 15 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [enabled])

  // iOS "Add to Home Screen" hint (installed PWAs get much stronger iOS storage).
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    try {
      if (localStorage.getItem('te_ios_hint') === '1') return
      const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
      const standalone = (navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches
      if (isIos && !standalone) setIosHint(true)
    } catch { /* ignore */ }
  }, [enabled])

  // Storage-quota warning (>80% used).
  useEffect(() => {
    if (!enabled) return
    navigator.storage?.estimate?.().then(e => {
      if (e.quota && e.usage && e.usage / e.quota > 0.8) setQuotaWarn(true)
    }).catch(() => {})
  }, [enabled])

  function dismissIos() {
    try { localStorage.setItem('te_ios_hint', '1') } catch { /* ignore */ }
    setIosHint(false)
  }

  if (!enabled) return null

  return (
    <div className="fixed bottom-4 inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none">
      {updateReady && (
        <div className="pointer-events-auto bg-brand-700 text-white rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-3 max-w-md w-full">
          <RefreshCw className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm flex-1">A new version is available.</span>
          <button onClick={() => window.location.reload()} className="text-sm font-semibold bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1">Reload</button>
          <button onClick={() => setUpdateReady(false)} className="text-white/70 hover:text-white"><X className="h-4 w-4" /></button>
        </div>
      )}
      {quotaWarn && (
        <div className="pointer-events-auto bg-amber-50 border border-amber-200 text-amber-800 rounded-xl shadow px-4 py-2.5 flex items-center gap-3 max-w-md w-full">
          <HardDrive className="h-4 w-4 flex-shrink-0" />
          <span className="text-sm flex-1">Device storage is over 80% full — sync &amp; free space to avoid losing offline data.</span>
          <button onClick={() => setQuotaWarn(false)} className="text-amber-500 hover:text-amber-700"><X className="h-4 w-4" /></button>
        </div>
      )}
      {iosHint && (
        <div className="pointer-events-auto bg-white border border-gray-200 text-gray-700 rounded-xl shadow px-4 py-2.5 flex items-center gap-3 max-w-md w-full">
          <Share className="h-4 w-4 flex-shrink-0 text-brand-600" />
          <span className="text-sm flex-1">Tip: tap Share → <span className="font-medium">Add to Home Screen</span> so the app works reliably offline.</span>
          <button onClick={dismissIos} className="text-sm font-semibold text-brand-600 hover:text-brand-700">Got it</button>
        </div>
      )}
    </div>
  )
}
