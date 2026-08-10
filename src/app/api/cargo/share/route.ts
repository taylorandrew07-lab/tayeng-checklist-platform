// Mint / read / revoke the public share link for a cargo voyage's data annex.
//
// Deliberately NOT a service-role route. Every statement here runs as the signed-in
// caller, so the mig-168 policies (admin, or the surveyor who owns the voyage) are
// the authority on who may publish a voyage's readings. A service-role write would
// have moved that decision into application code, where it can drift.
//
// The token is minted here rather than in the browser so it comes from the Node
// CSPRNG and never depends on what the client sends.

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** 32 bytes of CSPRNG as base64url — 43 chars, 256 bits. Unguessable at any
 *  request rate an attacker could sustain, which matters because the token IS
 *  the credential. */
function mintToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Where the links point. NEXT_PUBLIC_SHARE_BASE_URL lets the share domain be
 *  switched (e.g. to reports.tayeng.com) without touching this code or the
 *  domain staff happen to be using when they press the button. */
function shareBase(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SHARE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL
  return (configured || new URL(request.url).origin).replace(/\/+$/, '')
}

const linkFor = (request: Request, token: string) => `${shareBase(request)}/r/${token}`

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

/** The current live link for a voyage, if one has been issued. */
export async function GET(request: Request) {
  const voyageId = new URL(request.url).searchParams.get('voyageId')
  if (!voyageId) return NextResponse.json({ error: 'voyageId is required' }, { status: 400 })

  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // RLS returns nothing if the caller may not share this voyage, so an
  // unauthorised caller simply sees "no link" rather than an error to probe.
  const { data, error } = await supabase
    .from('cargo_voyage_shares')
    .select('token, created_at, view_count, last_viewed_at')
    .eq('voyage_id', voyageId)
    .is('revoked_at', null)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!data) return NextResponse.json({ link: null })

  return NextResponse.json({
    link: {
      url: linkFor(request, data.token),
      createdAt: data.created_at,
      viewCount: data.view_count ?? 0,
      lastViewedAt: data.last_viewed_at,
    },
  })
}

/** Create the link, or return the existing live one (one live link per voyage). */
export async function POST(request: Request) {
  let body: { voyageId?: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const voyageId = body.voyageId
  if (!voyageId) return NextResponse.json({ error: 'voyageId is required' }, { status: 400 })

  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // The voyage must already be synced — the annex is rendered from the row in
  // Supabase, so a link to a device-only voyage would 404 for the recipient.
  const { data: voyage } = await supabase
    .from('cargo_voyages').select('id').eq('id', voyageId).maybeSingle()
  if (!voyage) {
    return NextResponse.json(
      { error: 'This voyage has not been synced yet. Sync it first, then create the link.' },
      { status: 409 }
    )
  }

  const { data: existing } = await supabase
    .from('cargo_voyage_shares')
    .select('token, created_at, view_count, last_viewed_at')
    .eq('voyage_id', voyageId)
    .is('revoked_at', null)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      link: {
        url: linkFor(request, existing.token), createdAt: existing.created_at,
        viewCount: existing.view_count ?? 0, lastViewedAt: existing.last_viewed_at,
      },
      created: false,
    })
  }

  const token = mintToken()
  const { data: inserted, error } = await supabase
    .from('cargo_voyage_shares')
    .insert({ token, voyage_id: voyageId, created_by: user.id })
    .select('token, created_at')
    .single()

  if (error || !inserted) {
    // The insert policy is what rejects a caller who may not share this voyage.
    return NextResponse.json({ error: error?.message ?? 'Could not create the link.' }, { status: 403 })
  }

  return NextResponse.json({
    link: { url: linkFor(request, inserted.token), createdAt: inserted.created_at, viewCount: 0, lastViewedAt: null },
    created: true,
  })
}

/** Revoke the live link. The URL stops working immediately and for good — a new
 *  one gets a fresh token, so a withdrawn link can never be resurrected. */
export async function DELETE(request: Request) {
  const voyageId = new URL(request.url).searchParams.get('voyageId')
  if (!voyageId) return NextResponse.json({ error: 'voyageId is required' }, { status: 400 })

  const { supabase, user } = await requireUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const { error } = await supabase
    .from('cargo_voyage_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('voyage_id', voyageId)
    .is('revoked_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
