// Shared calendar — browser-side data access. Visibility is enforced by RLS
// (see migration 038): leave is owner+admin only; general events follow their
// audience; jobs come from the SECURITY DEFINER get_calendar_jobs feed.

import { createClient } from '@/lib/supabase/client'
import type { CalendarEvent, CalendarJob, CalendarVisibility, UserRole } from '@/lib/types/database'

export interface CalendarEventRow extends CalendarEvent { owner_name: string | null }

const EVENT_SELECT = '*, owner:profiles!calendar_events_owner_id_fkey(full_name)'
function mapRow(r: any): CalendarEventRow {
  return { ...r, owner_name: r.owner?.full_name ?? null }
}

async function myId(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser()
  return user?.id ?? null
}

/** Jobs + visible events overlapping [startISO, endISO] (inclusive, YYYY-MM-DD). */
export async function listCalendar(startISO: string, endISO: string): Promise<{ jobs: CalendarJob[]; events: CalendarEventRow[] }> {
  const supabase = createClient()
  const [jobsRes, eventsRes] = await Promise.all([
    supabase.rpc('get_calendar_jobs', { p_start: startISO, p_end: endISO }),
    supabase.from('calendar_events').select(EVENT_SELECT)
      .lte('start_date', endISO).gte('end_date', startISO),
  ])
  return {
    jobs: (jobsRes.data as CalendarJob[]) ?? [],
    events: ((eventsRes.data as any[]) ?? []).map(mapRow),
  }
}

export interface LeaveInput { start_date: string; end_date: string; description?: string | null }

export async function requestLeave(input: LeaveInput): Promise<{ error?: string }> {
  const uid = await myId()
  if (!uid) return { error: 'Not signed in.' }
  const { error } = await createClient().from('calendar_events').insert({
    event_type: 'leave', status: 'pending', visibility: 'private',
    title: 'Leave', description: input.description || null,
    start_date: input.start_date, end_date: input.end_date,
    owner_id: uid, created_by: uid, color: '#f59e0b',
  })
  return { error: error?.message }
}

export interface GeneralEventInput {
  title: string; description?: string | null
  start_date: string; end_date: string
  visibility: CalendarVisibility
  visible_roles?: UserRole[]
  visible_user_ids?: string[]
  color?: string | null
}

export async function createGeneralEvent(input: GeneralEventInput): Promise<{ error?: string }> {
  const uid = await myId()
  const { error } = await createClient().from('calendar_events').insert({
    event_type: 'general', status: 'approved',
    title: input.title.trim(), description: input.description || null,
    start_date: input.start_date, end_date: input.end_date,
    visibility: input.visibility,
    visible_roles: input.visibility === 'roles' ? (input.visible_roles ?? []) : [],
    visible_user_ids: input.visibility === 'users' ? (input.visible_user_ids ?? []) : [],
    color: input.color || '#3b82f6', created_by: uid,
  })
  return { error: error?.message }
}

export async function updateGeneralEvent(id: string, input: GeneralEventInput): Promise<{ error?: string }> {
  const { error } = await createClient().from('calendar_events').update({
    title: input.title.trim(), description: input.description || null,
    start_date: input.start_date, end_date: input.end_date,
    visibility: input.visibility,
    visible_roles: input.visibility === 'roles' ? (input.visible_roles ?? []) : [],
    visible_user_ids: input.visibility === 'users' ? (input.visible_user_ids ?? []) : [],
    color: input.color || '#3b82f6',
  }).eq('id', id)
  return { error: error?.message }
}

export async function deleteEvent(id: string): Promise<{ error?: string }> {
  const { error } = await createClient().from('calendar_events').delete().eq('id', id)
  return { error: error?.message }
}

/** Admin: approve or reject a pending leave request. */
export async function reviewLeave(id: string, decision: 'approved' | 'rejected', comment?: string): Promise<{ error?: string }> {
  const uid = await myId()
  const { error } = await createClient().from('calendar_events').update({
    status: decision, reviewer_id: uid, review_comment: comment?.trim() || null,
    reviewed_at: new Date().toISOString(),
  }).eq('id', id)
  return { error: error?.message }
}

/** Pending leave requests (admins see all; surveyors see their own) for the
 *  approvals panel. */
export async function listPendingLeave(): Promise<CalendarEventRow[]> {
  const { data } = await createClient().from('calendar_events').select(EVENT_SELECT)
    .eq('event_type', 'leave').eq('status', 'pending')
    .order('start_date', { ascending: true })
  return ((data as any[]) ?? []).map(mapRow)
}
