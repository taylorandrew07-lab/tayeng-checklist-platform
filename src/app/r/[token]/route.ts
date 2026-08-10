// PUBLIC read-only share link for a cargo voyage data annex.
//
//   GET /r/<token>  →  a standalone HTML document. Nothing else.
//
// This is the ONLY unauthenticated data surface in the app, so be deliberate
// about what it is and is not:
//
//   * It is a Route Handler, not a page. It returns a complete HTML document it
//     builds itself, so the dashboard layout, the nav, the Supabase browser
//     client and every app script are never involved. There is no way to
//     navigate from this document into the app — it contains no links to it.
//   * It never reads or writes a cookie, and never creates a session. Holding
//     the token authenticates nothing; it selects one row.
//   * The service-role client is used ONLY after the token has been resolved to
//     a single voyage id, and only to read that voyage. The key never reaches
//     the browser: the page is fully rendered on the server and ships as static
//     markup with its data already inlined.
//   * The token is the whole credential, so it is compared against a table of
//     issued tokens and nothing is inferred from its shape. Unknown, revoked and
//     expired all return an identical 404, so a holder of a dead link cannot
//     learn whether it ever existed.
//
// /r is not in proxy.ts's PROTECTED_PREFIXES, so the auth gate passes it
// through — which is what we want, and why that list must never grow a catch-all.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { renderVoyageAnnex } from '@/lib/cargo/share/annex'
import type { Voyage } from '@/lib/cargo/types'
import { getLetterheadDataUrl } from '@/lib/cargo/share/letterhead'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Same body for every failure mode — see the note above about not leaking
 *  whether a token was revoked, expired or never issued. */
function notFound() {
  return new NextResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Link not available</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f1f3f7;color:#0f172a;font-family:Inter,"Segoe UI",system-ui,sans-serif;text-align:center;padding:24px}
h1{font-size:19px;font-weight:640;margin:0 0 8px}p{color:#475569;font-size:14px;margin:0;max-width:38ch;line-height:1.6}</style>
</head><body><div><h1>This link is no longer available</h1>
<p>It may have been withdrawn, or it may have expired. Please contact Taylor Engineering for a current link.</p>
</div></body></html>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' } }
  )
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  // Cheap shape check before touching the database — the tokens we mint are
  // 43-char base64url. Anything else cannot be one of ours.
  if (!token || token.length < 20 || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) return notFound()

  const supabase = createServiceClient()

  const { data: share, error } = await supabase
    .from('cargo_voyage_shares')
    .select('token, voyage_id, revoked_at, expires_at, view_count')
    .eq('token', token)
    .maybeSingle()

  if (error || !share) return notFound()
  if (share.revoked_at) return notFound()
  if (share.expires_at && new Date(share.expires_at) < new Date()) return notFound()

  // Scoped to exactly the one voyage the token names. `doc` is the voyage
  // document; no join, no other table, nothing about the job, client or invoice.
  const { data: row } = await supabase
    .from('cargo_voyages')
    .select('id, status, doc, synced_at')
    .eq('id', share.voyage_id)
    .maybeSingle()

  if (!row?.doc) return notFound()

  const voyage = { ...(row.doc as Voyage), id: row.id, status: row.status } as Voyage

  // Best-effort view accounting — never block serving the document on it.
  supabase.from('cargo_voyage_shares')
    .update({ view_count: (share.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
    .eq('token', token)
    .then(() => {}, () => {})

  const html = renderVoyageAnnex(voyage, {
    logoDataUrl: await getLetterheadDataUrl(new URL(request.url).origin).catch(() => null),
    generatedAt: new Date(),
    // The page is rendered fresh on every request, but the READINGS are only as
    // recent as the surveyor's last sync — they work offline at sea for days.
    // Both are stated so a fresh-looking page can't imply fresh figures.
    dataAsAt: voyage.updatedAt ?? null,
    receivedAt: row.synced_at ?? null,
  })

  return new NextResponse(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Never indexed, never archived by a crawler that finds the URL forwarded.
      'x-robots-tag': 'noindex, nofollow, noarchive',
      // The document contains commercial survey data — no shared/CDN caching.
      'cache-control': 'private, no-store, max-age=0, must-revalidate',
      'referrer-policy': 'no-referrer',
    },
  })
}
