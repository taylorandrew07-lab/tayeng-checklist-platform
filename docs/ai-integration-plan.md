# AI Integration Plan — Taylor Engineering Checklist Platform

**Status:** Planning / read-only audit (2026-07-04). Nothing built yet.
**Goal:** weave AI automation through the app with **per-feature choice of model _and_ provider** (bring-your-own-model), done as configuration, not code.

This document is the synthesis of a four-lens read-only audit (opportunity map, integration
seams, model/provider abstraction, privacy/cost guardrails). The detailed surveys are in the
appendices.

> Migration note: the next free migration number is **131** (129 = re-open lock, 130 = staff_private
> PII split shipped 2026-07-04). Some appendix text below says 126/128 — that was stale; use 131+.

---

## 1. The core: provider/model choice as configuration

The centerpiece, and the thing the owner specifically wants — many places to pick a different
model or a different AI provider, without touching code.

- **One provider-agnostic interface** via the **Vercel AI SDK** (`ai` + `@ai-sdk/anthropic` /
  `@ai-sdk/openai` / `@ai-sdk/google` / local OpenAI-compatible). Swapping provider/model = changing
  one argument.
- **DB-driven config** (mirrors `office_permission_catalog` + `app_settings`):
  - `ai_feature_catalog` — registry of AI features, each with a default model + a vetted allowed-models list.
  - `ai_feature_config` — the owner's per-feature choice (provider, model, params, fallback, spend cap).
  - `ai_global_config` + `ai_usage_log` — global defaults + spend/token logging.
- **Admin model-picker UI** at `/admin/ai` (clone the existing settings page): per feature, pick
  Provider → Model, params, a fallback provider, a Test button, a cost/latency hint.
- **Keys server-side only** (env vars, like Resend/MS-Graph). CSP already blocks the browser from
  calling providers — all AI runs in `/api/ai/*` routes.
- **Adding a feature = two declarative additions** (a code registry entry with prompt+schema, and
  one seed row).

## 2. Where AI plugs in (ranked opportunities)

Dominant theme: "opaque upload → human re-keys data" and "structured data → human types prose."

**Quick, high-value (rails already exist):**
1. Invoice cover-emails + overdue reminders — draft-then-send rail is built (`api/invoice-email/[invoiceId]`).
2. Report narrative + executive summary (job + cargo/DRI) — biggest hand-typed-prose sink.
3. Photo auto-captioning — `job_photos.caption` exists but has no UI.
4. Message compose/reply/summarize.
5. Vessel-document auto-categorization on upload.

**Extraction (kill re-keying):**
6. Credential-scan extraction (passport/permit/insurance).
7. Receipt OCR → expense line.

**Bigger bets:**
8. Sounding/hydrostatic table OCR → interpolation (needs a verification UI).
9. Semantic/NL search over jobs & reports (pgvector).
10. Vision photo hold/camera auto-assign; scheduling leave-conflict + assignment suggestions
    (the leave-conflict check is a non-AI quick win).

## 3. Guardrails

- **Data-sensitivity tiers × provider trust tiers:** RESTRICTED (invoices, pay, PII, credential
  scans) → local/enterprise only; CONFIDENTIAL (client names, report text, photos) → enterprise;
  INTERNAL (findings, names redacted) → standard cloud OK. Never send `client_billing` /
  `staff_private` / `personal_documents` / invoices to a public model.
- **Redact-and-rehydrate** client/vessel/surveyor identifiers server-side; RLS is the backstop.
- **Human-in-the-loop always:** AI produces a draft labeled "AI draft — review"; never advances
  `report_approved`, never auto-sends email, never auto-writes an invoice.
- **Audit + cost:** `ai_call_log` mirroring `activity_log` (unforgeable actor) + per-feature/global
  spend caps + kill-switch. AI is online-only, gated behind `reachable()`, never in the offline queue.

## 4. Architecture seams

- **Server seam:** clone `api/pdf/[jobId]/route.ts` authorize-then-elevate (RLS client checks
  session+role+`is_active`, then service client reads context). New routes `/api/ai/*`, library `src/lib/ai/`.
- **Offline:** surveyors capture offline; AI runs later server-side when admin/office opens the
  report online (matches the +74h prelim-report async model).
- **Config/gating:** reuse `app_settings`, office permissions, per-template flags.

## 5. Suggested build order

- **Phase 0** — foundation (`ai_*` tables + `runAiFeature()` runner + `/admin/ai` picker) + one
  flagship feature end-to-end. Start with invoice-emails (fastest) or report-summaries (highest value).
- **Phase 1** — extraction features (captions, credential/receipt) share one extract-from-upload service.
- **Phase 2** — semantic search, table OCR.

---

# Appendix A — AI opportunity map

_(Full survey; ranked by value ÷ effort. Baseline: no AI/ML/OCR/embeddings today; search is SQL
`ILIKE`, classification is manual dropdowns, uploads are opaque storage. Two clean insertion seams:
draft-then-send email (`src/lib/email/graph.ts`) and deterministic-report-then-human-edit
(`buildReportBlocks`, `generateUhtEmail`). Surveyors are offline-first — place every feature at an
online boundary, never in the at-sea capture loop.)_

1. **Invoice cover-email + overdue-reminder drafting** — S, online, financial/PII. Text gen. Body is
   hard-coded (`api/invoice-email/[invoiceId]/route.ts:30-36`); overdue chasing manual
   (`reconciliation.ts`, ReconcileTab). Highest ratio — plumbing done, only prose missing.
2. **DRI SOF / voyage-log / hold-condition narration** — M, online at report-build, low sensitivity.
   Largest hand-typed-prose sink (`SofLogger.tsx`, `DriWizard.tsx`, `dri-report.ts:143-201`). Adds the
   findings/conclusion section that doesn't exist today.
3. **Photo auto-captioning** — M, online at report-build, low sensitivity. `job_photos.caption` exists
   with no entry UI; `JobPDF.tsx:692/740` falls back to positional placeholders.
4. **Job-report narrative + executive summary** — M, online, mild client-data. Summarization + gen into
   `api/pdf/[jobId]` / `JobPDF.tsx`.
5. **Credential-scan extraction** — S–M, online, sensitive PII. Users re-key number/issue/expiry
   (`CredentialsManager.tsx`, `personal-docs/api.ts`). Gate to owner/admin; don't retain.
6. **Receipt OCR → expense-line auto-fill** — S–M, online, financial (`LineItemsEditor.tsx`,
   `invoice-receipts` bucket).
7. **Internal-messaging compose/reply + thread summarize** — S, online, low sensitivity
   (`ComposeModal.tsx`, `inbox/page.tsx`). Preserve the one-email-per-recipient privacy in
   `api/messages/send/route.ts`.
8. **Vessel-document auto-categorization** — S, online, low sensitivity (`documents/api.ts:33`,
   `VesselFolderView.tsx`).
9. **Rate/price suggestion for unmatched job types** — S–M, online, financial. A SQL "last price for
   client+job_type" captures most value; LLM adds parsing of free-text rate notes (`ClientRates.tsx`).
10. **Sounding/hydrostatic table OCR → interpolation** — L, online, low sensitivity. Feeds
    `InterpolationCalculator.tsx`; needs a verification UI (wrong draughts = wrong survey).
11. **Semantic/NL search over jobs & reports** — L, online, mixed. `globalSearch` is `ILIKE` on 4
    columns (`search/global.ts`). Needs pgvector + RLS-aware retrieval. Cheaper interim: Postgres FTS/trigram.
12. **Vision photo hold/camera auto-assign & ordering** — M–L, online, low sensitivity.
    `assign.ts` uses filename regex + EXIF; keep that as the offline fallback.
13. **Scheduling: leave-conflict warning + assignment recommendation** — M, online, low sensitivity.
    The leave-conflict check is pure logic — ship without AI; AI recommends the best surveyor.

**Cross-cutting:** reuse the two existing seams (draft-then-send, deterministic-report-then-edit);
keep the calc engine (`evaluateCalculation`) deterministic — put AI upstream of it; the dominant
pattern is "opaque upload → human re-keys" (items 3,5,6,8,10,12 could share one extract-from-upload
service); inherit existing sensitivity gates (`assertInvoicingAccess`, RLS).

---

# Appendix B — Integration seams

**Server surfaces:** trusted code runs only in App Router API routes (`src/app/api/*/route.ts`); no
server actions. Canonical auth pattern = `createClient()` → `getUser()` → check
`profiles.role/is_active` → then elevate to `createServiceClient()`. Shared clients in
`src/lib/supabase/server.ts`. Cleanest AI template: `api/pdf/[jobId]/route.ts` (authorize with user
client, then assemble context with service client).

**Secrets/config:** all secrets in `process.env`, server-only; only 3 `NEXT_PUBLIC_` vars (Supabase
url/anon + app url). **AI provider keys must NOT be `NEXT_PUBLIC_`.** Config-optional pattern
(`send.ts`/`graph.ts` return null/false when unset) → mirror with `getAiConfig()`. **CSP**
(`next.config.js`) `connect-src 'self' https://*.supabase.co` — the browser cannot call providers;
all AI HTTP must be server-side. `'unsafe-eval'` is deliberately absent — no client-side eval of AI output.

**Data/RLS:** RLS is pervasive and is the security backbone. Two approaches: (1) authorize-then-elevate
(recommended, the pdf-route model); (2) RLS-bound read (safer, limited). Rule: never return AI output
derived from data the caller couldn't access.

**Generation pipeline:** job reports (`api/pdf/[jobId]` → `JobPDF.tsx`, react-pdf server-only) and
cargo/DRI (`dri-report.ts` builds a `Block[]` consumed by both docx and pdf). Inject AI text as a
content block upstream; keep AI a content producer, never a layout producer. `pdf_preamble`/`pdf_disclaimer`
(mig 105/092) are existing free-text blocks an AI summary can populate with zero new plumbing.

**Offline:** gate AI affordances behind `src/lib/offline/reachable.ts`; keep AI out of the `syncDraft`
offline write queue; never block checklist save/submit on an AI call; generate server-side on demand or async.

**Extensibility patterns to reuse:** `src/lib/features.ts` (global flag), `app_settings` single-row
table (mig 043), `office_user_permissions` + `has_office_permission()` (mig 025), per-template
`pdf_*` flags.

---

# Appendix C — Model/provider abstraction

**Recommendation: Vercel AI SDK** (`ai` + `@ai-sdk/anthropic`/`@ai-sdk/openai`/`@ai-sdk/google`, `zod`).
One call shape across providers (`generateText`/`generateObject`); swapping provider = swapping the
`model` arg. `generateObject` + zod gives provider-agnostic structured output. A hand-rolled adapter
would re-implement streaming/tool-calls/structured-output/usage across 3+ SDKs; an OpenAI-compatible
gateway adds a hop and flattens provider-specific features. The AI SDK can still point at a gateway
`baseURL` later, so this doesn't preclude one. Pin `ai@^5` + matching `@ai-sdk/*` against React 19 /
Next 16; use only the server-side exports.

**Seed defaults (all DB-editable):** report drafting → `claude-opus-4-8`; summarize/extract →
`claude-sonnet-5`; quick classify/caption → `claude-haiku-4-5`. The owner can repoint any feature to
`gpt-*` / `gemini-*` / local from the UI.

**Config tables (migration `131_ai_config.sql`):** `ai_global_config` (single-row defaults + global
spend cap), `ai_feature_catalog` (declarative registry: feature_key, label, category, default
provider/model, `allowed_models` JSONB), `ai_feature_config` (per-feature override: provider, model,
params, enabled, fallback, monthly_cap), `ai_usage_log`. RLS: admin-manage, no anon/surveyor read
(AI runs server-side under the service client). Seed the catalog with `ON CONFLICT DO UPDATE`.

**Code registry (`src/lib/ai/features.ts`):** DB owns the *choice*; code owns the *prompt template +
zod input/output schemas* (versioned with the app). Adding a feature = one `AI_FEATURES` entry + one
seed row.

**Keys:** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `AI_LOCAL_BASE_URL`
in Vercel env, server-only, auto-read by `@ai-sdk/*`. Graceful degradation when a key is absent. A DB
secrets table is not recommended (larger blast radius) unless in-app key entry is later wanted
(then encrypt via pgcrypto, service-role only).

**Provider-agnostic entry point (`src/lib/ai/runAiFeature.ts`):** resolve config
(feature_config → catalog → global), check enabled + spend cap, run `generateObject` with
`getModel(provider, model)` (the only SDK-aware file, `src/lib/ai/providers.ts`), try the fallback
chain on error/refusal, log usage. Callers just do `runAiFeature('report.draft', input)`.

**Model-picker UX (`/admin/ai` + `AiFeatureCard`):** clone `admin/settings/page.tsx` (super-admin
guard, RPC load, "migration not installed" banner). Per feature: Provider→Model dropdowns from
`allowed_models`, enabled toggle, params, fallback selector, cost/latency hint, Test button (POST
`/api/ai/run`, shows object + model + tokens + latency). Writes via `admin_*` SECURITY DEFINER RPCs
(copy mig 014).

**Folder layout:** `src/lib/ai/{features,runAiFeature,providers,config,usage,types}.ts`;
`src/app/api/ai/run/route.ts`; `src/app/(dashboard)/admin/ai/page.tsx`;
`src/components/admin/AiFeatureCard.tsx`.

---

# Appendix D — Data / privacy / cost / trust guardrails

**Sensitive-data inventory (carry forward existing RLS rulings):** HIGH — survey findings
(`job_field_values`), report narrative/PDF, job attachments, photos. MEDIUM — client name, vessel
name/IMO, messages/calendar, activity log. **CRITICAL / never to a public model** — `client_billing`
(contact/bank/tax/AP), `client_rates`, invoices/lines/taxes/`bank_accounts`, surveyor pay/hours,
`staff_private` (passport/ID/permit), `personal_documents` + scans.

**Provider trust tiers:** T0 local/on-prem → RESTRICTED (financials/PII/credential scans); T1
enterprise/zero-retention → CONFIDENTIAL (real report narrative, client-named email); T2 standard
cloud → INTERNAL only (redacted). Enforce in code (`src/lib/ai/policy.ts`) — refuse to build a request
whose data class exceeds the resolved provider's tier (fail-closed).

**Redaction:** tokenize-and-rehydrate server-side (client→`[CLIENT_1]`, vessel→`[VESSEL_1]`, etc.),
map kept in request memory only, reversed on output. Identifier sources: `clients.name`,
`vessels.name/imo/official_number`, `profiles.full_name`, report/job numbers. RLS is the backstop —
fetch context as the user; confidential columns aren't visible to leak. Hard exclusions from every
prompt: `staff_private.*`, `personal_documents.doc_number`+scans, `bank_accounts.*`,
`client_billing.bank_details/tax_number/ap_*`, invoice amounts (unless an approved T0/T1 finance feature).

**Consent & audit:** global `ai_enabled` + per-feature flags in `app_settings` (default off, staged
rollout like `CLIENT_PORTAL_ENABLED`); optional per-client `ai_opt_out`. Dedicated `ai_call_log`
(typed cost/token columns) with a `BEFORE INSERT` trigger forcing `actor_id := auth.uid()` (the
`enforce_activity_actor()` pattern, mig 050), append-only, admin/office read. Log **blocked** attempts.
Do **not** store prompt/response bodies — token counts / hashes only. Wrap every call in one audited
helper (like `logActivity()`).

**Cost controls:** cheapest capable model default for high-volume tasks; caps at per-call (max_tokens),
per-feature/month, and global (auto-flip `ai_enabled` off + notify admin); per-user/feature rate limits
(online-only, never queued for offline replay); admin "AI usage" view over `ai_call_log`; est-cost from
a per-model price table.

**Human-in-the-loop:** reports — AI draft only, must land before `report_approved`; no AI may advance
approval status; label "AI draft — review." Client-facing text/email — draft-not-send, explicit human
send. Financial outputs — advisory next to real figures, human keys the invoice. Mark AI-touched fields
for provenance. Fail-closed — on error/timeout/policy-block, degrade to the manual flow; never block
the workflow, never silently substitute empty output (the calc-field silent-failure lesson).
