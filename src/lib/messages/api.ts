// Internal messaging — browser-side data access. Reads go through RLS (you see
// messages you sent, received, or — as an admin — all). Sends go through the
// service-role API route /api/messages/send. See migration 037.

import { createClient } from '@/lib/supabase/client'
import type { UserRole } from '@/lib/types/database'

export type InboxFilter = 'all' | 'unread' | 'archived'

export interface InboxItem {
  recipientRowId: string
  messageId: string
  read_at: string | null
  archived_at: string | null
  created_at: string
  subject: string
  body: string
  sender_id: string | null
  sender_name: string
}

export interface SentItem {
  id: string
  subject: string
  body: string
  created_at: string
  recipientCount: number
}

export interface MessageDetail {
  id: string
  subject: string
  body: string
  sender_id: string | null
  sender_name: string
  parent_id: string | null
  created_at: string
}

async function myId(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser()
  return user?.id ?? null
}

/** Received messages. `all` = active inbox (not archived); `unread` = unread &
 *  not archived; `archived` = archived only. */
export async function listInbox(filter: InboxFilter = 'all'): Promise<InboxItem[]> {
  const uid = await myId()
  if (!uid) return []
  let q = createClient()
    .from('message_recipients')
    .select('id, message_id, read_at, archived_at, created_at, message:messages(subject, body, sender_id, sender:profiles(full_name))')
    .eq('recipient_id', uid)
    .order('created_at', { ascending: false })
  if (filter === 'archived') q = q.not('archived_at', 'is', null)
  else q = q.is('archived_at', null)
  if (filter === 'unread') q = q.is('read_at', null)

  const { data } = await q
  return ((data ?? []) as any[]).map(r => ({
    recipientRowId: r.id,
    messageId: r.message_id,
    read_at: r.read_at,
    archived_at: r.archived_at,
    created_at: r.created_at,
    subject: r.message?.subject ?? '(no subject)',
    body: r.message?.body ?? '',
    sender_id: r.message?.sender_id ?? null,
    sender_name: r.message?.sender?.full_name ?? 'Unknown',
  }))
}

/** Messages the current user has sent, with a recipient count. */
export async function listSent(): Promise<SentItem[]> {
  const uid = await myId()
  if (!uid) return []
  const { data } = await createClient()
    .from('messages')
    .select('id, subject, body, created_at, recipients:message_recipients(count)')
    .eq('sender_id', uid)
    .order('created_at', { ascending: false })
  return ((data ?? []) as any[]).map(m => ({
    id: m.id,
    subject: m.subject,
    body: m.body,
    created_at: m.created_at,
    recipientCount: m.recipients?.[0]?.count ?? 0,
  }))
}

export async function getMessage(id: string): Promise<MessageDetail | null> {
  const { data } = await createClient()
    .from('messages')
    .select('id, subject, body, sender_id, parent_id, created_at, sender:profiles(full_name)')
    .eq('id', id).single()
  if (!data) return null
  const d = data as any
  return {
    id: d.id, subject: d.subject, body: d.body, sender_id: d.sender_id,
    sender_name: d.sender?.full_name ?? 'Unknown', parent_id: d.parent_id, created_at: d.created_at,
  }
}

export async function markRead(messageId: string): Promise<void> {
  const uid = await myId()
  if (!uid) return
  await createClient().from('message_recipients')
    .update({ read_at: new Date().toISOString() })
    .eq('message_id', messageId).eq('recipient_id', uid).is('read_at', null)
}

export async function archive(messageId: string): Promise<void> {
  const uid = await myId()
  if (!uid) return
  await createClient().from('message_recipients')
    .update({ archived_at: new Date().toISOString() })
    .eq('message_id', messageId).eq('recipient_id', uid)
}

export async function unarchive(messageId: string): Promise<void> {
  const uid = await myId()
  if (!uid) return
  await createClient().from('message_recipients')
    .update({ archived_at: null })
    .eq('message_id', messageId).eq('recipient_id', uid)
}

/** Unread, non-archived count for the nav badge. Returns 0 on any error so the
 *  app keeps working before migration 037 is applied. */
export async function unreadCount(): Promise<number> {
  const uid = await myId()
  if (!uid) return 0
  const { count, error } = await createClient()
    .from('message_recipients')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', uid).is('read_at', null).is('archived_at', null)
  if (error) return 0
  return count ?? 0
}

export async function sendMessage(payload: {
  subject: string; body: string; recipientIds?: string[]; recipientRoles?: UserRole[]; parentId?: string
}): Promise<{ ok?: boolean; error?: string }> {
  const res = await fetch('/api/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return { error: json?.error ?? 'Could not send message.' }
  return { ok: true }
}
