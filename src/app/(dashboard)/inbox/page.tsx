'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import EmptyState from '@/components/ui/EmptyState'
import Tabs from '@/components/ui/Tabs'
import { Loader2, Mail, Send, Plus, Archive, Reply, Inbox as InboxIcon, ArchiveRestore, Trash2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useRealtimeRefresh } from '@/lib/realtime'
import { RowDeleteButton } from '@/components/ui/RowDeleteButton'
import { confirmDialog } from '@/components/ui/confirm'
import { toast } from '@/components/ui/toast'
import ComposeModal, { type ComposeInitial } from '@/components/messages/ComposeModal'
import {
  listInbox, listSent, getMessage, markRead, archive, unarchive, deleteReceived,
  type InboxItem, type SentItem, type InboxFilter, type MessageDetail,
} from '@/lib/messages/api'

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }, { key: 'archived', label: 'Archived' },
]

// Render messages in pages to keep long inboxes light.
const PAGE_SIZE = 30

export default function InboxPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [tab, setTab] = useState<'inbox' | 'sent'>('inbox')
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [sent, setSent] = useState<SentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<MessageDetail | null>(null)
  const [detailArchived, setDetailArchived] = useState(false)
  const [compose, setCompose] = useState<{ open: boolean; initial?: ComposeInitial }>({ open: false })
  const [refresh, setRefresh] = useState(0)
  const [shown, setShown] = useState(PAGE_SIZE)
  const tick = useRealtimeRefresh('message_recipients')

  useEffect(() => {
    async function loadMe() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase.from('profiles').select('role, is_super_admin').eq('id', user.id).single()
      setIsAdmin(data?.role === 'admin' || data?.is_super_admin === true)
    }
    loadMe()
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      if (tab === 'inbox') {
        const items = await listInbox(filter)
        if (!cancelled) setInbox(items)
      } else {
        const items = await listSent()
        if (!cancelled) setSent(items)
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [tab, filter, tick, refresh])

  // New list (switched tab/filter) starts at the first page.
  useEffect(() => { setShown(PAGE_SIZE) }, [tab, filter])

  async function openDetail(messageId: string, archivedRow: boolean, wasUnread: boolean) {
    const d = await getMessage(messageId)
    if (!d) return
    setDetail(d); setDetailArchived(archivedRow)
    if (wasUnread) { await markRead(messageId) }
  }

  async function doArchive(messageId: string) { await archive(messageId); setDetail(null) }
  async function doUnarchive(messageId: string) { await unarchive(messageId); setDetail(null) }

  // Delete removes MY copy only (migration 166) — the sender keeps it in Sent.
  // Drop it from the list straight away so the row goes on tap; the realtime
  // refresh reconciles a moment later either way.
  async function doDelete(messageIds: string[]) {
    const res = await deleteReceived(messageIds)
    if (res.error) { toast.error(res.error); return }
    setInbox(prev => prev.filter(m => !messageIds.includes(m.messageId)))
    setDetail(d => (d && messageIds.includes(d.id) ? null : d))
    toast.success(messageIds.length === 1 ? 'Message deleted' : `${res.deleted ?? messageIds.length} messages deleted`)
  }

  // Clear out everything the current filter is showing — the point of the
  // feature is not having to tap 40 messages one at a time. Names the view in
  // the confirm so "delete all" can never be read as "delete my whole inbox"
  // when you are looking at Unread.
  async function doDeleteAll() {
    const ids = inbox.map(m => m.messageId)
    if (ids.length === 0) return
    const what = filter === 'archived' ? 'archived message' : filter === 'unread' ? 'unread message' : 'message in your inbox'
    const ok = await confirmDialog({
      title: `Delete ${ids.length} ${what}${ids.length === 1 ? '' : 's'}?`,
      message: `This removes your copy of ${ids.length === 1 ? 'it' : 'them'} for good — there is no trash to restore from. The sender keeps their own copy.`,
      confirmLabel: 'Delete them', danger: true,
    })
    if (!ok) return
    await doDelete(ids)
  }

  function openReply(d: MessageDetail) {
    const initial: ComposeInitial = {
      subject: /^re:/i.test(d.subject) ? d.subject : `Re: ${d.subject}`,
      parentId: d.id,
    }
    if (isAdmin && d.sender_id) { initial.recipientIds = [d.sender_id]; initial.toLabel = d.sender_name }
    setDetail(null)
    setCompose({ open: true, initial })
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="text-gray-500 mt-0.5">Messages and announcements.</p>
        </div>
        <button onClick={() => setCompose({ open: true })} className="btn-primary"><Plus className="h-4 w-4" />New message</button>
      </div>

      <Tabs
        active={tab}
        onChange={k => setTab(k as 'inbox' | 'sent')}
        tabs={[
          { key: 'inbox', label: <span className="inline-flex items-center gap-2"><InboxIcon className="h-4 w-4" />Inbox</span> },
          { key: 'sent', label: <span className="inline-flex items-center gap-2"><Send className="h-4 w-4" />Sent</span> },
        ]}
      />

      {tab === 'inbox' && (
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`text-sm px-3 py-1 rounded-full border transition-colors ${filter === f.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {f.label}
            </button>
          ))}
          {!loading && inbox.length > 0 && (
            <button onClick={doDeleteAll}
              className="ml-auto inline-flex items-center gap-1.5 text-sm px-3 py-1 rounded-full border border-gray-300 bg-white text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 hover:border-red-200">
              <Trash2 className="h-3.5 w-3.5" />Delete all ({inbox.length})
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : tab === 'inbox' ? (
        inbox.length === 0 ? (
          <EmptyState icon={Mail} title={filter === 'archived' ? 'No archived messages' : filter === 'unread' ? 'No unread messages' : 'Your inbox is empty'} />
        ) : (
          <>
          <div className="card divide-y divide-gray-100">
            {/* The row is a flex CONTAINER, not a button — a delete button can't be
                nested inside the button that opens the message. */}
            {inbox.slice(0, shown).map(m => {
              const unread = !m.read_at
              return (
                <div key={m.recipientRowId} className="group flex items-start gap-1 pr-2 hover:bg-gray-50 transition-colors">
                  <button onClick={() => openDetail(m.messageId, !!m.archived_at, unread)}
                    className="min-w-0 flex-1 text-left flex items-start gap-3 px-4 py-3">
                    <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${unread ? 'bg-brand-500' : 'bg-transparent'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`truncate ${unread ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>{m.sender_name}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(m.created_at)}</span>
                      </div>
                      <p className={`text-sm truncate ${unread ? 'text-gray-900' : 'text-gray-600'}`}>{m.subject}</p>
                      <p className="text-xs text-gray-400 truncate">{m.body.slice(0, 120)}</p>
                    </div>
                  </button>
                  {/* Always visible on touch, where there is no hover to reveal it. */}
                  <RowDeleteButton
                    className="mt-3 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    onDelete={() => doDelete([m.messageId])}
                    ariaLabel={`Delete message: ${m.subject}`}
                    confirmTitle="Delete this message?"
                    confirmMessage={`"${m.subject}" will be removed from your inbox for good — there is no trash to restore from. The sender keeps their own copy.`}
                  />
                </div>
              )
            })}
          </div>
          {inbox.length > shown && (
            <div className="flex justify-center"><button onClick={() => setShown(s => s + PAGE_SIZE)} className="btn-secondary">Show more <span className="text-gray-400">({inbox.length - shown} more)</span></button></div>
          )}
          </>
        )
      ) : (
        sent.length === 0 ? (
          <EmptyState icon={Send} title="No sent messages" description="Messages you send will appear here." />
        ) : (
          <>
          <div className="card divide-y divide-gray-100">
            {sent.slice(0, shown).map(m => (
              <button key={m.id} onClick={() => openDetail(m.id, false, false)}
                className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-gray-800 truncate">{m.subject}</p>
                    <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(m.created_at)}</span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">To {m.recipientCount} recipient{m.recipientCount !== 1 ? 's' : ''} · {m.body.slice(0, 100)}</p>
                </div>
              </button>
            ))}
          </div>
          {sent.length > shown && (
            <div className="flex justify-center"><button onClick={() => setShown(s => s + PAGE_SIZE)} className="btn-secondary">Show more <span className="text-gray-400">({sent.length - shown} more)</span></button></div>
          )}
          </>
        )
      )}

      {/* Message detail */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.subject ?? ''} size="lg"
        footer={detail && tab === 'inbox' ? (
          <>
            <RowDeleteButton
              label="Delete" className="mr-auto"
              onDelete={() => doDelete([detail.id])}
              confirmTitle="Delete this message?"
              confirmMessage={`"${detail.subject}" will be removed from your inbox for good — there is no trash to restore from. The sender keeps their own copy.`}
            />
            {detailArchived
              ? <button onClick={() => doUnarchive(detail.id)} className="btn-secondary"><ArchiveRestore className="h-4 w-4" />Unarchive</button>
              : <button onClick={() => doArchive(detail.id)} className="btn-secondary"><Archive className="h-4 w-4" />Archive</button>}
            <button onClick={() => openReply(detail)} className="btn-primary"><Reply className="h-4 w-4" />Reply</button>
          </>
        ) : undefined}
      >
        {detail && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">From <span className="font-medium text-gray-900">{detail.sender_name}</span></span>
              <span className="text-gray-400">{formatDate(detail.created_at)}</span>
            </div>
            <p className="text-gray-900 whitespace-pre-wrap">{detail.body}</p>
          </div>
        )}
      </Modal>

      {compose.open && (
        <ComposeModal
          open
          isAdmin={isAdmin}
          initial={compose.initial}
          onClose={() => setCompose({ open: false })}
          onSent={() => setRefresh(n => n + 1)}
        />
      )}
    </div>
  )
}


