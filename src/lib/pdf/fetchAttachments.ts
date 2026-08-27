// Fetching the documents that mergeAttachments will append (migration 202).
//
// SERVER ONLY. Lives next to mergeAttachments because the two halves share one budget:
// this module decides what is worth paying for, that one decides what is worth printing,
// and they must agree on the wording when either refuses.
//
// WHY IT IS NOT AN INLINE Promise.all IN THE ROUTE
// It was, and it had three holes that only show up on a bad day — and a bad day here
// costs Andrew a report that had ALREADY RENDERED, which is strictly worse than the
// behaviour before attachments existed, when Storage could not affect the report at all.
//
//  1. NOTHING RACED THE DOWNLOAD AGAINST A CLOCK. `storage.download()` takes no
//     AbortSignal and the service client is built with the platform fetch and no timeout
//     (lib/supabase/server.ts), so a stalled connection yields a promise that NEVER
//     SETTLES. "A download failure is just another degrade reason; it never rejects"
//     covers a rejection — a hang is not a rejection, and no try/catch sees one. The
//     await then held a finished PDF until maxDuration (60s) killed the function, or
//     fetchJobPdfFile aborted the client at 70s. Andrew gets "Could not generate the
//     report" and no PDF.
//  2. NO BOUND ON CONCURRENCY. `Promise.all` over the plan fired every download at once.
//     An "attach" question is an ordinary photo field: it takes as many files as the
//     surveyor gives it, each up to the bucket's 25 MB (migration 033). Twenty of them
//     is half a gigabyte landing in the function together, before pdf-lib's own copy and
//     `out.save()` on top.
//  3. THE CAPS WERE APPLIED AFTER THE BYTES HAD LANDED. mergeAttachments' 10 MB/file and
//     15 MB/total limits were only consulted once each file was fully in memory, so an
//     oversized attachment was paid for in full and THEN refused.
//
// So: one at a time, in checklist order, under one wall-clock budget, with the size caps
// checked from Content-Length before the body is read and the read itself bounded in
// case the length is absent or lying. mergeAttachments stays the authority and re-checks
// everything that does arrive; this only declines to pay for what it will refuse.

import { ATTACHMENT_REASONS, MAX_ATTACHMENT_BYTES, MAX_TOTAL_BYTES, type AttachmentPlan } from './mergeAttachments'

/** Settle `p` with `fallback` if it has not settled within `ms`.
 *
 *  The guard against non-settlement specifically. An already-settled promise wins this
 *  race outright even at ms = 0 (its reaction is a microtask; the timer is not), so a
 *  finished download is never thrown away by an expired budget. */
export async function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      p,
      new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), Math.max(0, ms)) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Read a body, abandoning it the moment it exceeds `cap`.
 *
 *  `res.arrayBuffer()` would buffer the whole thing before anyone could object, which is
 *  exactly the hole being closed — so the body is drained a chunk at a time and cancelled
 *  as soon as the running total crosses the cap. */
export async function readCapped(res: Response, cap: number): Promise<Uint8Array | 'over-cap'> {
  if (!res.body) {
    const whole = new Uint8Array(await res.arrayBuffer())
    return whole.byteLength > cap ? 'over-cap' : whole
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => {})
      return 'over-cap'
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength }
  return out
}

export type LoadAttachmentsOptions = {
  /** Batch-sign the storage paths. One round trip, itself deadline-capped.
   *  Nullable fields because that is exactly what createSignedUrls returns: a row can
   *  carry an error and a null url, and those are filtered out below. */
  signUrls: (paths: string[]) => Promise<Array<{ path: string | null; signedUrl: string | null }>>
  /** Absolute wall-clock deadline (ms since epoch) for signing AND every download. */
  deadline: number
  /** Per-file ceiling, so one slow file cannot eat the whole budget. */
  perFetchMs: number
  /** Injectable for tests; the platform fetch in production. */
  fetchImpl?: typeof fetch
}

/**
 * Download each planned attachment, in plan (checklist) order, one at a time.
 *
 * NEVER THROWS and never fails to settle: every entry comes back either with `bytes` or
 * with a `reason`, and the entry's `number` is untouched, so the separator page and the
 * in-body "see Attachment N" cross-reference stay true either way.
 */
export async function loadAttachments(
  plan: AttachmentPlan[],
  opts: LoadAttachmentsOptions,
): Promise<AttachmentPlan[]> {
  const { signUrls, deadline, perFetchMs } = opts
  const doFetch = opts.fetchImpl ?? fetch
  if (plan.length === 0) return []

  const signed = await withDeadline<Array<{ path: string | null; signedUrl: string | null }>>(
    signUrls(plan.map(a => a.storagePath)).catch(() => []),
    deadline - Date.now(),
    [],
  )
  const urlByPath = new Map<string, string>()
  for (const s of signed) if (s?.path && s?.signedUrl) urlByPath.set(s.path, s.signedUrl)

  const loaded: AttachmentPlan[] = []
  let spent = 0

  for (const a of plan) {
    const url = urlByPath.get(a.storagePath)
    const left = deadline - Date.now()
    // Budget gone, or the whole appended-source allowance already used: do not open a
    // connection at all. This is what stops the twentieth attachment costing anything.
    if (!url || left <= 0) { loaded.push({ ...a, reason: ATTACHMENT_REASONS.unretrievable }); continue }
    if (spent >= MAX_TOTAL_BYTES) { loaded.push({ ...a, reason: ATTACHMENT_REASONS.totalLimit }); continue }

    // Never buffer more than this one file could possibly contribute to the merge.
    const cap = Math.min(MAX_ATTACHMENT_BYTES, MAX_TOTAL_BYTES - spent)
    const budget = Math.min(perFetchMs, left)
    const ctrl = new AbortController()
    try {
      // Both an AbortSignal (so the socket is really released) and a race (so a fetch
      // that ignores the signal still cannot hold the response). Either alone leaves a
      // hole; the pair is what makes non-settlement impossible.
      const res = await withDeadline<Response | null>(
        doFetch(url, { signal: ctrl.signal }).catch(() => null),
        budget,
        null,
      )
      if (!res || !res.ok) {
        ctrl.abort()
        await res?.body?.cancel().catch(() => {})
        loaded.push({ ...a, reason: ATTACHMENT_REASONS.unretrievable })
        continue
      }

      // The cheap exit: refuse on the DECLARED size, before a byte of body is read.
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > 0 && declared > cap) {
        ctrl.abort()
        await res.body?.cancel().catch(() => {})
        loaded.push({
          ...a,
          reason: declared > MAX_ATTACHMENT_BYTES
            ? ATTACHMENT_REASONS.tooLarge(declared)
            : ATTACHMENT_REASONS.totalLimit,
        })
        continue
      }

      const body = await withDeadline<Uint8Array | 'over-cap' | null>(
        readCapped(res, cap).catch(() => null),
        Math.min(perFetchMs, Math.max(0, deadline - Date.now())),
        null,
      )
      if (body === 'over-cap') {
        ctrl.abort()
        // The length was absent or understated; we know only that it crossed the cap.
        loaded.push({ ...a, reason: ATTACHMENT_REASONS.tooLarge(null) })
        continue
      }
      if (!body) {
        ctrl.abort()
        loaded.push({ ...a, reason: ATTACHMENT_REASONS.unretrievable })
        continue
      }
      spent += body.byteLength
      loaded.push({ ...a, bytes: body })
    } catch {
      ctrl.abort()
      loaded.push({ ...a, reason: ATTACHMENT_REASONS.unretrievable })
    }
  }

  return loaded
}
