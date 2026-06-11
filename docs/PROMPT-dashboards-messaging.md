# Build Prompt — Role Dashboards (build-out) + Email-style Messaging Inbox

> Paste this whole file into a fresh Claude Code session in VS Code to build the feature.
> Two independent parts — you can run Part A and Part B separately. Written against the
> existing Tayeng App codebase and its conventions (see `HANDOFF.md`).

---

## Existing app facts — DO NOT re-derive (reuse these patterns)

- **Stack:** Next.js 16.2.7 (App Router, TS) + React 19 + Tailwind + Supabase
  (Postgres/Auth/Storage/RLS) + Vercel. Production build is `next build --webpack` (pinned in
  `vercel.json`).
- **Roles:** `admin`, `surveyor`, `client`, `office` (enum `user_role`) + `is_super_admin`
  flag on `profiles`. Super admin id: `77fdfdae-f417-4f95-853d-a9fc48bfab8d`.
- **Authorization is enforced in Postgres RLS** via SECURITY-DEFINER helpers that already
  exist: `is_admin()`, `is_office()`, `has_office_permission(key)`, `is_active_staff()`
  (active admin/surveyor). Never gate on `user_metadata`.
- **Migrations are hand-run by the user** in the Supabase SQL Editor. Write **idempotent**,
  numbered SQL — continue from the highest existing number. "Paste-the-whole-file" style.
  NEVER run migrations via CLI or push DB changes; write the `.sql` and tell the user to run it.
- **Reuse these precedents:**
  - *Dashboards already exist:* `/admin` (`src/app/(dashboard)/admin/page.tsx`), `/surveyor`,
    `/office`, `/client`. The admin dashboard's yellow **pending-approvals banner** is the
    canonical "needs attention" widget pattern — copy its style.
  - *Live refresh:* `useRealtimeRefresh(table)` in `src/lib/realtime.ts` (Supabase Realtime +
    focus/poll fallback; safe under RLS). Use it for live unread badges and dashboard refresh.
  - *Sidebar unread badge:* `src/components/layout/Sidebar.tsx` already renders a count badge on
    the Users nav item via the `pendingCount` prop — mirror it for an inbox unread count.
  - *Service-role privileged writes guarded by RLS reads:* see
    `/api/profile-requests/[id]/review/route.ts` and `createServiceClient` in
    `src/lib/supabase/server.ts`. Use this shape for the message-send action.
  - *Email (optional):* Resend via `src/app/api/notify/admin/route.ts` (`escapeHtml`,
    `safeSubject`, `sendEmail`). If a shared `src/lib/email/send.ts` exists, reuse it.
  - *Office capabilities:* add any new office capability as a key in `office_permission_catalog`
    (migration 025) gated by `has_office_permission(key)`; do NOT build a parallel system.
- **Types:** all DB row types live in `src/lib/types/database.ts` — update it.
- **Gates before pushing (all must pass):** `npx tsc --noEmit`, `npm run lint` (0 errors;
  pre-existing React-Compiler warnings are OK), `npm test`, `npm run build`. Push code to
  `main` only after verified. Update `HANDOFF.md`. Do NOT open a PR unless asked. Do NOT run or
  apply migrations.

---

# PART A — Dashboard build-out ("Needs your attention")

Each role already has a dashboard. Add a reusable **"Needs your attention"** card near the top
of each that surfaces expiring items and anything awaiting review. Keep it data-driven and
quiet when there's nothing (render nothing if the list is empty, like the admin banner).

**Reusable component:** `src/components/dashboard/AttentionCard.tsx` — takes a list of items
`{ icon, label, detail, href, tone: 'warn' | 'info' | 'danger' }` and renders the
amber/banner style used by the admin pending-approvals banner. One card, role-specific contents.

**Per-role contents (only show rows that apply):**
- **Admin** (`/admin`): keep the existing pending-approvals banner; ADD expiring/expired
  personal documents across all surveyors (if the personal-documents feature is present —
  table `personal_documents`, expiring within `reminder_lead_days`), plus any other
  review queues. Link each row to the relevant page.
- **Surveyor** (`/surveyor`): their OWN documents expired / expiring soon (link to their
  profile/documents); any messages flagged for them (if Part B is built) is optional here.
- **Office** (`/office`): expiring surveyor documents **only if** granted `personal_docs.view`;
  otherwise nothing. Keep it read-only.
- **Client** (`/client`): nothing for now (placeholder; no attention items defined yet).

**Expiry source:** reuse `expiryStatus()` from `src/lib/personal-docs/api.ts` if present. If the
personal-documents feature is NOT yet in the codebase, build the AttentionCard with the
approvals/review rows only and leave a clearly-commented hook for document rows.

Use `useRealtimeRefresh('personal_documents')` / `('profiles')` as appropriate so the card
updates without a manual reload. No schema changes required for Part A.

---

# PART B — Email-style messaging inbox (async, NOT live chat)

A simple internal inbox. Two flows: (1) an admin pushes an update/announcement to relevant
accounts (by role or specific people); (2) any user sends a message to a specific account
(e.g. to report an app issue). Read in an inbox, mark read/archive. No live typing, no threads
required (optional simple replies).

## B1 — Migration (new numbered file)

`public.messages`:
```
id          UUID PK DEFAULT uuid_generate_v4()
sender_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL
subject     TEXT NOT NULL
body        TEXT NOT NULL
parent_id   UUID REFERENCES messages(id) ON DELETE CASCADE   -- optional: simple replies
created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

`public.message_recipients` (fan-out: one row per recipient):
```
id           UUID PK DEFAULT uuid_generate_v4()
message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE
recipient_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
read_at      TIMESTAMPTZ
archived_at  TIMESTAMPTZ
created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
UNIQUE (message_id, recipient_id)
```
Indexes: `message_recipients(recipient_id)`, `message_recipients(message_id)`,
`messages(sender_id)`.

**RLS — reads guarded; privileged fan-out done server-side:**
- `messages` SELECT: allowed if the caller is the `sender_id`, OR `is_admin()`, OR there EXISTS
  a `message_recipients` row for this message with `recipient_id = auth.uid()`.
- `message_recipients` SELECT: caller's own rows (`recipient_id = auth.uid()`) OR `is_admin()`.
- `message_recipients` UPDATE: caller may update ONLY their own row, and ONLY the `read_at` /
  `archived_at` columns (mirror migration 004's safe-field allowlist mechanism — re-create a
  column-diff trigger or `WITH CHECK` so recipients can't reassign messages). 
- **No direct client INSERT** into either table (or restrict INSERT so a user can only insert a
  message they send AND cannot fabricate recipient rows). Prefer: no INSERT policy at all —
  all sends go through the service-role API route below, which enforces who-can-message-whom.
- Admins may DELETE (moderation); recipients archive rather than delete.

## B2 — Send API route (`POST /api/messages/send`, service role)

Authorizes the sender, then fans out recipient rows with `createServiceClient`. Body:
`{ subject, body, recipientIds?: string[], recipientRoles?: UserRole[], parentId? }`.

**Authorization rules (enforce server-side):**
- Active **admin/super-admin**: may send to any specific users and/or broadcast to any role(s).
- Active **surveyor / office / client**: may send only to admins (resolve to all active
  admins/super-admins) — i.e. "report an issue / contact admin". (Confirm with me if you want a
  broader allowlist.)
- Resolve `recipientRoles` to active profile ids; merge with `recipientIds`; de-dupe; never
  include the sender unless explicitly self-addressed. Insert one `messages` row + N
  `message_recipients` rows in a transaction-like sequence (roll back the message if recipient
  insert fails). Rate-limit per sender (reuse the in-memory limiter pattern from
  `/api/notify/admin`).
- **Optional:** after sending, email each recipient via Resend (`sendEmail`) with subject + a
  deep link to `/inbox`. Make this best-effort and non-blocking.

## B3 — UI

- **Data lib:** `src/lib/messages/api.ts` — `listInbox()`, `listSent()`, `getMessage(id)`,
  `markRead(id)`, `archive(id)`, `unreadCount()`, and a `sendMessage()` wrapper that calls the
  API route.
- **Inbox page** `/(dashboard)/inbox/page.tsx` (shared by all roles): list of received messages
  (sender, subject, snippet, date, unread dot), filter All / Unread / Archived, click to open a
  detail view that marks it read; archive action; "Compose" button. A "Sent" tab shows messages
  the user sent.
- **Compose modal:** subject + body; recipient picker. Admins get a role multi-select ("All
  surveyors", "All office", specific people via a searchable user list); non-admins get a fixed
  "To: Administrators" (no arbitrary picker). Reuse `Modal`, `btn-primary`, `input-base`.
- **Sidebar:** add an "Inbox" / "Messages" nav item (icon e.g. `Mail`/`Inbox`) for every role
  via the role nav arrays in `Sidebar.tsx`, with an **unread badge** mirroring the existing
  `pendingCount` badge. Drive the count with `useRealtimeRefresh('message_recipients')` +
  `unreadCount()` so it updates live without polling infra.
- Add row types to `src/lib/types/database.ts`.

## Open decisions — ask me if unsure, otherwise use these defaults
1. Can non-admins message anyone other than admins? Default: no (admins only) to prevent spam.
2. Email-on-arrival via Resend: default ON (best-effort), or skip if no `sendEmail` helper.
3. Replies/threading: default = simple optional reply via `parent_id`, flat (no nested
   threads). Confirm if you want full threads.
4. Should admins see ALL messages (moderation) or only their own inbox? Default: admins can read
   all (oversight), per the RLS above.

## Deliverables
- Part A: `AttentionCard` component + wired into each role dashboard. No migration.
- Part B: one numbered migration (`messages` + `message_recipients` + RLS + safe-update
  trigger), `POST /api/messages/send`, `src/lib/messages/api.ts`, inbox UI, sidebar item +
  unread badge. Update `src/lib/types/database.ts`.
- All gates green (`tsc`, lint 0 errors, tests, `next build --webpack`). Update `HANDOFF.md`.
- Do NOT open a pull request unless asked. Do NOT run or apply the migration.
