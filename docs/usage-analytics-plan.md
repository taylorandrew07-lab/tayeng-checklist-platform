# Tayeng — Usage Tracking & Friction Monitoring Plan (next phase)

_How to capture real usage data, real‑time signals, and areas of friction — **so you can see
where people struggle before and after the consistency pass.** This is the plan only; nothing
here is implemented yet._

The goal you stated: *monitor how people use the app, get real‑time data, and find pain points
and inefficiencies.* There are three different questions hiding in that, and they need three
different tools — one tool won't answer all three well:

| Question | What answers it | Signal type |
|----------|----------------|-------------|
| **"Where do people get stuck / rage‑tap / drop off?"** | Product analytics + session replay | Behavioural |
| **"What's actually breaking for them?"** | Error + performance monitoring | Technical |
| **"Which flows are slow / heavy / failing to sync?"** | Custom domain events + Web Vitals | Business + perf |

---

## 1. Recommended stack

**Primary: PostHog** (product analytics) + **Sentry** (errors/perf) + a **thin custom
`analytics_events` table in your own Supabase** for domain events you want to own outright.

Why this trio, given your context (solo owner, Next.js 16 + Supabase, offline‑first PWA, real
users in the field):

- **PostHog** — *autocapture* means you get clicks, pageviews, and form interactions with almost
  no manual instrumentation, so you get signal on day one. It also gives you **session replay**
  (literally watch a surveyor fumble a sub‑44px button), **funnels** (quantify New‑Job →
  Checklist → Submit drop‑off), **heatmaps**, and **feature flags** (huge for the consistency
  pass — see §5). Can be self‑hosted or EU‑cloud if you want data residency. Generous free tier.
- **Sentry** — the "what's breaking" layer. Captures unhandled errors, failed fetches, and
  **Web Vitals (INP)** with the stack trace + the *replay of the session that crashed*. This is
  where your flaky‑wifi submit failures and the blank‑legacy‑pill bug would have shown up
  automatically.
- **Your own `analytics_events` table** — for a handful of high‑value **domain** events you want
  to query with SQL alongside your business data and never lose to a vendor: `job_created`,
  `checklist_submitted`, `sync_succeeded/failed`, `invoice_created`, `report_downloaded`. You
  already own Supabase; this is ~one table + one insert helper + an RLS policy.

**Alternatives considered:** Vercel Analytics/Speed Insights (good, cheap Web Vitals, but no
replay/funnels — a complement, not a replacement); Plausible/Umami (privacy‑friendly pageviews
only — too shallow for friction hunting); pure custom Supabase (full ownership but you'd rebuild
funnels/replay/heatmaps by hand — not worth it for a solo team). **PostHog covers the most
ground for the least build.**

---

## 2. Instrument through ONE seam (don't scatter `track()` calls)

The audit's biggest lesson — drift comes from copy‑paste — applies to analytics too. Wrap every
provider behind a single module so you can swap tools, respect offline, and enforce a typed event
list:

```ts
// src/lib/analytics/track.ts  (the ONLY place components import)
export type AnalyticsEvent =
  | { name: 'job_created';        props: { jobId: string; source: 'admin'|'surveyor'|'ai'; jobType: string } }
  | { name: 'checklist_submitted';props: { jobId: string; durationMs: number; retries: number } }
  | { name: 'sync_failed';        props: { entity: 'cargo'|'checklist'; reason: string } }
  | { name: 'form_abandoned';     props: { form: string; lastField: string } }
  // …closed union so a typo can't create a phantom event

export function track(e: AnalyticsEvent): void { /* → PostHog + offline queue */ }
```

This mirrors your existing `createDraftJob(payload, source)` seam — one funnel everything flows
through. Autocapture handles the generic clicks; `track()` handles the ~15 **domain** moments that
matter.

---

## 3. Offline‑first is the special requirement (most guides ignore it)

Your surveyors work on weak/no wifi, so **events must survive offline** or you'll get a biased
picture (you'd only ever see the sessions that had good signal — exactly the ones *without*
friction). You already have the machinery:

- Queue events in **IndexedDB** (reuse the cargo/checklist sync pattern) and flush on reconnect.
- PostHog's browser SDK buffers, but for your own domain events, ride your existing sync engine so
  a `sync_failed` event itself doesn't get lost when sync fails.
- Stamp every event with a **client timestamp** (when it happened) *and* a server‑received
  timestamp (when it arrived) — the gap between them is itself a friction signal (how long people
  spend offline mid‑task).

---

## 4. What to actually measure (map directly to the audit's friction)

Instrument the specific pain points the audit found, so you can prove the consistency pass worked:

**Friction / behaviour**
- **Rage clicks / dead clicks** (PostHog autocaptures these) — will light up on the hover‑only,
  sub‑44px cargo photo controls and surveyor dashboard buttons.
- **Funnel drop‑off** on the multi‑step flows: New Job → Checklist entry → Submit; cargo Voyage →
  Readings → Finalise → Report. Where do people bail?
- **Form abandonment** — fire `form_abandoned` with the last‑touched field when a dirty form
  unmounts without saving (the unsaved‑changes dialogs are a natural hook).
- **Time‑on‑task** per role for the core jobs (how long to submit a checklist on mobile vs
  desktop — directly tests your mobile‑parity concern).
- **Repeated back‑and‑forth** (e.g. the `?focus` Edit round‑trip in clients) shows up as a
  navigation loop in replay.

**Technical friction**
- **INP (Interaction to Next Paint)** — your #1 Web Vital for "feels laggy"; watch it on the heavy
  screens the audit flagged for over‑fetching (`JobOpsPanel` reload, surveyor dashboard).
- **Failed requests / retries** — count `submitJobWithRetry` retries and `sync_failed` events per
  user/day. A spike = a connectivity or RLS problem in the field.
- **Error rate by route/role** (Sentry) — especially anything client‑facing.

**Business / usage**
- Active users by role, feature adoption (which job types, which reports), invoices created,
  reports downloaded — the domain events in your own table, query‑able next to your data.

---

## 5. The one thing to do *before* the consistency pass

Add **PostHog session replay + autocapture now, even at a basic level**, and let it run for a week
or two on the *current* app. That gives you a **baseline** — so when you standardize Save/Edit/Delete
and fix the touch targets, you can show rage‑clicks and task‑time dropping, not just assume they
did. Feature flags then let you roll the new shared primitives (`RowDeleteButton`, `ResponsiveTable`)
to a subset and **A/B the friction** before full rollout.

> Sequencing suggestion: **(1)** drop in PostHog + Sentry with autocapture only (an afternoon,
> near‑zero code) → **(2)** run the consistency pass with a baseline to measure against → **(3)**
> add the typed `track()` seam + domain events + offline queue as the deliberate build.

---

## 6. Privacy, RLS & data‑residency (do this right the first time)

- **Respect your existing privacy model.** Pay/rate/currency are hidden from surveyors in the UI
  and wire (migs 130/155‑157) — never let an analytics payload leak them. The typed event union in
  §2 is your guard: no event should carry a pay figure.
- **No PII in event props.** Use `userId` (uuid) + `role`, never names/emails, in event bodies.
  PostHog can identify users by uuid and you resolve names only in your own DB when needed.
- **RLS on `analytics_events`.** Insert‑only for authenticated users; **read restricted to
  admin/owner** (same pattern as your sensitive tables). It's a write‑heavy, admin‑read table.
- **Consent / notice.** Internal staff app → a line in your usage policy is typically enough, but
  **clients** are external — check what your client agreements allow before enabling replay on
  client‑facing screens; you can scope replay to staff roles only.
- **Data residency.** If any client contract requires it, self‑host PostHog or use its EU cloud;
  keep domain events in your own Supabase region regardless.

---

## 7. Rough effort
- **Baseline (PostHog + Sentry autocapture):** ~half a day, mostly config.
- **Typed `track()` seam + ~15 domain events:** ~1–2 days.
- **Offline event queue on the existing sync engine:** ~1–2 days.
- **`analytics_events` table + RLS + admin dashboard:** ~1 day for the table, more if you want an
  in‑app dashboard (or just query in the PostHog UI / Supabase SQL to start).

**Bottom line:** PostHog (behaviour + replay + funnels + flags) **+** Sentry (errors + INP) **+** a
thin owned `analytics_events` table, all behind one offline‑aware `track()` seam, with a baseline
captured *before* the consistency pass so you can prove the friction dropped.
