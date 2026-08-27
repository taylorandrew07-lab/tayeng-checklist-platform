// The report ALWAYS delivers. These tests are about the ways Storage can stop that from
// being true — and every one of them describes something that produced no error, no
// rejection and no failing test before: a hang, a flood, or bytes paid for and thrown
// away. No network: `fetchImpl` and `signUrls` are injected.
import { describe, it, expect, vi } from 'vitest'
import { loadAttachments, readCapped, withDeadline } from './fetchAttachments'
import { ATTACHMENT_REASONS, MAX_ATTACHMENT_BYTES, MAX_TOTAL_BYTES, type AttachmentPlan } from './mergeAttachments'

const plan = (n: number, over: Partial<AttachmentPlan> = {}): AttachmentPlan => ({
  number: n,
  filename: `doc-${n}.pdf`,
  itemNumber: '6.9',
  title: 'Crew list',
  storagePath: `job/doc-${n}.pdf`,
  bytes: null,
  reason: null,
  ...over,
})

const signAll = (paths: string[]) =>
  Promise.resolve(paths.map(p => ({ path: p, signedUrl: `https://storage.test/${p}` })))

// `new Response(uint8Array)` is valid at runtime; the DOM lib's BodyInit does not admit
// a Uint8Array<ArrayBufferLike>, so hand it the underlying buffer.
const buf = (bytes: Uint8Array) => bytes.buffer as ArrayBuffer

const body = (bytes: Uint8Array, headers: Record<string, string> = {}) =>
  new Response(buf(bytes), { status: 200, headers: { 'content-length': String(bytes.byteLength), ...headers } })

const opts = (fetchImpl: any, ms = 5_000) => ({
  signUrls: signAll,
  deadline: Date.now() + ms,
  perFetchMs: ms,
  fetchImpl: fetchImpl as typeof fetch,
})

describe('loadAttachments', () => {
  it('returns the bytes of each attachment, keeping its number', async () => {
    const out = await loadAttachments([plan(1), plan(2)], opts(async () => body(new Uint8Array([1, 2, 3]))))
    expect(out.map(a => a.number)).toEqual([1, 2])
    expect(out.every(a => a.bytes?.byteLength === 3 && a.reason === null)).toBe(true)
  })

  // DEFECT 1. A promise that never settles is not a rejection: no try/catch sees it, and
  // awaiting it held an ALREADY-RENDERED report until Vercel killed the function at 60s.
  it('degrades a download that never settles instead of hanging forever', async () => {
    const started = Date.now()
    const out = await loadAttachments(
      [plan(1)],
      opts(() => new Promise<Response>(() => { /* never settles, and never rejects */ }), 60),
    )
    expect(Date.now() - started).toBeLessThan(3_000)
    expect(out[0].bytes).toBeNull()
    expect(out[0].reason).toBe(ATTACHMENT_REASONS.unretrievable)
  })

  it('aborts the request it gave up on, so the socket is released', async () => {
    let seen: AbortSignal | undefined
    await loadAttachments(
      [plan(1)],
      opts((_u: string, init: RequestInit) => {
        seen = init.signal as AbortSignal
        return new Promise<Response>(() => {})
      }, 40),
    )
    expect(seen?.aborted).toBe(true)
  })

  it('stops opening connections once the wall clock is spent', async () => {
    const impl = vi.fn(async () => body(new Uint8Array([1])))
    // A deadline already in the past: not one request may be issued.
    const out = await loadAttachments([plan(1), plan(2)], {
      signUrls: signAll, deadline: Date.now() - 1, perFetchMs: 1_000, fetchImpl: impl as any,
    })
    expect(impl).not.toHaveBeenCalled()
    expect(out.map(a => a.reason)).toEqual([ATTACHMENT_REASONS.unretrievable, ATTACHMENT_REASONS.unretrievable])
  })

  // DEFECT 3a. Promise.all fired every download at once: twenty files at the bucket's
  // 25 MB cap is half a gigabyte arriving in the function together.
  it('downloads ONE AT A TIME, never concurrently', async () => {
    let inFlight = 0
    let peak = 0
    const impl = async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      return body(new Uint8Array([1]))
    }
    await loadAttachments([1, 2, 3, 4, 5].map(n => plan(n)), opts(impl))
    expect(peak).toBe(1)
  })

  // DEFECT 3b. The caps lived in mergeAttachments and were consulted only after each
  // file had been buffered in full — so an oversized attachment was paid for in RAM and
  // bandwidth and THEN refused.
  it('refuses an oversized attachment on Content-Length, without reading the body', async () => {
    let bodyRead = false
    const huge = new Uint8Array(16)
    const impl = async () => {
      const res = body(huge, { 'content-length': String(MAX_ATTACHMENT_BYTES + 1) })
      const orig = res.body!.getReader.bind(res.body)
      Object.defineProperty(res, 'body', {
        value: { getReader: () => { bodyRead = true; return orig() }, cancel: async () => {} },
      })
      return res
    }
    const out = await loadAttachments([plan(1)], opts(impl))
    expect(bodyRead).toBe(false)
    expect(out[0].bytes).toBeNull()
    expect(out[0].reason).toBe(ATTACHMENT_REASONS.tooLarge(MAX_ATTACHMENT_BYTES + 1))
  })

  it('still bounds the read when Content-Length is absent or lying', async () => {
    // 12 MB delivered in chunks with no declared length: readCapped must give up partway.
    const chunk = new Uint8Array(1024 * 1024)
    let sent = 0
    const impl = async () => new Response(
      new ReadableStream({
        pull(c) { if (sent++ >= 12) c.close(); else c.enqueue(chunk) },
      }),
      { status: 200 },
    )
    const out = await loadAttachments([plan(1)], opts(impl))
    expect(out[0].bytes).toBeNull()
    expect(out[0].reason).toBe(ATTACHMENT_REASONS.tooLarge(null))
  })

  it('never retains more than the total appended-source allowance', async () => {
    // Three files of 8 MB against a 15 MB total. Only the first can be kept; the other
    // two are refused on their declared size against what is LEFT of the allowance, so
    // nothing is silently truncated and nothing beyond the allowance is ever buffered.
    // (They still cost one headers-only round trip each — that is the price of not
    // knowing a file's size until Storage says so, and it carries no bytes.)
    const impl = vi.fn(async () => body(new Uint8Array(8 * 1024 * 1024)))
    const out = await loadAttachments([plan(1), plan(2), plan(3)], opts(impl))
    const retained = out.reduce((n, a) => n + (a.bytes?.byteLength ?? 0), 0)
    expect(retained).toBe(8 * 1024 * 1024)
    expect(retained).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
    expect(out[1].reason).toBe(ATTACHMENT_REASONS.totalLimit)
    expect(out[2].reason).toBe(ATTACHMENT_REASONS.totalLimit)
  })

  it('opens no connection at all once the allowance is fully spent', async () => {
    // 10 MB then 5 MB exactly exhausts the 15 MB total, so the third and fourth must not
    // be fetched — this is what stops the twentieth attachment costing anything.
    const sizes = [10 * 1024 * 1024, 5 * 1024 * 1024]
    const impl = vi.fn(async () => body(new Uint8Array(sizes.shift() ?? 1024)))
    const out = await loadAttachments([plan(1), plan(2), plan(3), plan(4)], opts(impl))
    expect(impl).toHaveBeenCalledTimes(2)
    expect(out.slice(0, 2).every(a => a.bytes !== null)).toBe(true)
    expect(out.slice(2).map(a => a.reason)).toEqual([ATTACHMENT_REASONS.totalLimit, ATTACHMENT_REASONS.totalLimit])
  })

  it('degrades an unsigned path and a non-OK response rather than throwing', async () => {
    const out = await loadAttachments([plan(1), plan(2)], {
      signUrls: async () => [{ path: 'job/doc-1.pdf', signedUrl: 'https://storage.test/a' }],
      deadline: Date.now() + 5_000,
      perFetchMs: 5_000,
      fetchImpl: (async () => new Response('nope', { status: 404 })) as any,
    })
    expect(out.map(a => a.reason)).toEqual([ATTACHMENT_REASONS.unretrievable, ATTACHMENT_REASONS.unretrievable])
  })

  it('degrades every attachment when signing itself hangs', async () => {
    const impl = vi.fn()
    const out = await loadAttachments([plan(1)], {
      signUrls: () => new Promise(() => {}),
      deadline: Date.now() + 50,
      perFetchMs: 50,
      fetchImpl: impl as any,
    })
    expect(impl).not.toHaveBeenCalled()
    expect(out[0].reason).toBe(ATTACHMENT_REASONS.unretrievable)
  })

  it('returns [] for an empty plan without signing anything', async () => {
    const sign = vi.fn()
    expect(await loadAttachments([], { signUrls: sign as any, deadline: Date.now() + 1000, perFetchMs: 100 })).toEqual([])
    expect(sign).not.toHaveBeenCalled()
  })
})

describe('withDeadline', () => {
  it('an ALREADY-SETTLED promise wins even at ms = 0', async () => {
    // The property the route's await site depends on: renderToBuffer can outlast the
    // attachment budget, and the downloads it overlapped with must not be thrown away.
    for (let i = 0; i < 50; i++) {
      expect(await withDeadline(Promise.resolve('kept'), 0, 'lost')).toBe('kept')
    }
  })

  it('falls back when nothing settles', async () => {
    expect(await withDeadline(new Promise(() => {}), 10, 'fallback')).toBe('fallback')
  })
})

describe('readCapped', () => {
  it('returns the whole body when it is under the cap', async () => {
    const out = await readCapped(new Response(buf(new Uint8Array([1, 2, 3]))), 10)
    expect(out).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('reports over-cap rather than buffering past it', async () => {
    expect(await readCapped(new Response(buf(new Uint8Array(100))), 10)).toBe('over-cap')
  })
})
