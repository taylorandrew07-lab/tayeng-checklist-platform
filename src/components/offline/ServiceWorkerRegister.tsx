'use client'

import { useEffect } from 'react'

/**
 * Registers the offline service worker for staff. When `enabled` is false (e.g. a
 * client logs in on a shared device) it actively UNREGISTERS any existing worker
 * and clears our caches, so offline support is truly staff-only.
 */
export default function ServiceWorkerRegister({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

    if (enabled) {
      const register = () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) }
      if (document.readyState === 'complete') register()
      else {
        window.addEventListener('load', register, { once: true })
        return () => window.removeEventListener('load', register)
      }
      return
    }

    // Not staff — tear down any previously-registered worker and our caches.
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(r => r.unregister()))
      .catch(() => {})
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then(keys => keys.filter(k => k.startsWith('tayeng-')).forEach(k => caches.delete(k)))
        .catch(() => {})
    }
  }, [enabled])

  return null
}
