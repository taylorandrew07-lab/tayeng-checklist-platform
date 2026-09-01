import { NextResponse } from 'next/server'

// A deliberately trivial same-origin probe. The login page uses it to tell
// "this device has no internet at all" apart from "this device can reach us but
// NOT Supabase" — the second is what a blocking router/VPN/antivirus looks like,
// and it needs completely different advice from "check your wifi".
//
// It must be a route the service worker never serves from cache: sw.js returns
// early for everything under /api/, and proxy.ts's matcher excludes api/ too, so
// this always goes to the network. Probing /manifest.json instead would have been
// wrong — the SW caches that one cache-first and would report "online" offline.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  )
}
