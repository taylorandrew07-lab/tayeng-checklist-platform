'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import { Loader2, Mail, Send, Plus, Archive, Reply, Inbox as InboxIcon, ArchiveRestore } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { useRealtimeRefresh } from '@/lib/realtime'
import ComposeModal, { type ComposeInitial } from '@/components/messages/ComposeModal'
import {
  listInbox, listSent, getMessage, markRead, archive, unarchive,
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

      <div className="flex items-center gap-1 border-b border-gray-200">
        <TabButton active={tab === 'inbox'} onClick={() => setTab('inbox')} icon={InboxIcon} label="Inbox" />
        <TabButton active={tab === 'sent'} onClick={() => setTab('sent')} icon={Send} label="Sent" />
      </div>

      {tab === 'inbox' && (
        <div className="flex gap-2">
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`text-sm px-3 py-1 rounded-full border transition-colors ${filter === f.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
              {f.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : tab === 'inbox' ? (
        inbox.length === 0 ? (
          <Empty icon={Mail} text={filter === 'archived' ? 'No archived messages.' : filter === 'unread' ? 'No unread messages.' : 'Your inbox is empty.'} />
        ) : (
          <>
          <div className="card divide-y divide-gray-100">
            {inbox.slice(0, shown).map(m => {
              const unread = !m.read_at
              return (
                <button key={m.recipientRowId} onClick={() => openDetail(m.messageId, !!m.archived_at, unread)}
                  className="w-full text-left flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
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
          <Empty icon={Send} text="You haven't sent any messages." />
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

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: React.ElementType; label: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${active ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      <Icon className="h-4 w-4" />{label}
    </button>
  )
}

function Empty({ icon: Icon, text }: { icon: React.ElementType; text: string }) {
  return <div className="card p-12 text-center text-gray-400"><Icon className="h-10 w-10 text-gray-300 mx-auto mb-3" />{text}</div>
}
