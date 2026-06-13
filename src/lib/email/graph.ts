// Microsoft 365 (Graph) — app-only (client-credentials) email. Used to create a
// DRAFT in the office mailbox with the invoice PDF attached; a person reviews
// and sends it from Outlook. No tokens are persisted; each call fetches a fresh
// app token. All config comes from env (never committed):
//   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_INVOICE_MAILBOX

const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface GraphConfig { tenantId: string; clientId: string; clientSecret: string; mailbox: string }

export function getGraphConfig(): GraphConfig | null {
  const tenantId = process.env.MS_TENANT_ID
  const clientId = process.env.MS_CLIENT_ID
  const clientSecret = process.env.MS_CLIENT_SECRET
  const mailbox = process.env.MS_INVOICE_MAILBOX
  if (!tenantId || !clientId || !clientSecret || !mailbox) return null
  return { tenantId, clientId, clientSecret, mailbox }
}

async function getAppToken(cfg: GraphConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  })
  const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error_description || json.error || 'Failed to obtain Microsoft token')
  return json.access_token as string
}

export interface DraftInput {
  to: string[]
  cc?: string[]
  subject: string
  html: string
  attachment: { name: string; contentBytesBase64: string; contentType?: string }
}

export interface DraftResult { id: string; webLink: string | null }

/** Create a draft message (with attachment) in the configured mailbox's Drafts. */
export async function createMailDraft(cfg: GraphConfig, input: DraftInput): Promise<DraftResult> {
  const token = await getAppToken(cfg)
  const message = {
    subject: input.subject,
    body: { contentType: 'HTML', content: input.html },
    toRecipients: input.to.filter(Boolean).map(address => ({ emailAddress: { address } })),
    ccRecipients: (input.cc ?? []).filter(Boolean).map(address => ({ emailAddress: { address } })),
    attachments: [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: input.attachment.name,
      contentType: input.attachment.contentType ?? 'application/pdf',
      contentBytes: input.attachment.contentBytesBase64,
    }],
  }
  const res = await fetch(`${GRAPH}/users/${encodeURIComponent(cfg.mailbox)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(message),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error?.message || 'Failed to create the email draft')
  return { id: json.id, webLink: json.webLink ?? null }
}
