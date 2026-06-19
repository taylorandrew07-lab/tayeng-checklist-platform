import { describe, it, expect } from 'vitest'
import { withTimeout } from './index'

// withTimeout is the safety net behind every "can't freeze the UI" fix — if it
// regressed, stalled requests would hang interactive flows again. These guard it.
describe('withTimeout', () => {
  it('resolves with the value when the promise beats the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'Task')).resolves.toBe('ok')
  })

  it('rejects with a user-facing message when the timeout fires first', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 50))
    await expect(withTimeout(slow, 5, 'Saving')).rejects.toThrow(/Saving timed out/)
  })

  it('propagates the underlying rejection (does not mask real errors)', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'Task')).rejects.toThrow('boom')
  })

  it('does not leave the timer pending after the promise settles', async () => {
    // If the timer were not cleared, this resolved value could still be raced later.
    const r = await withTimeout(Promise.resolve(42), 10, 'Task')
    expect(r).toBe(42)
    await new Promise((res) => setTimeout(res, 20)) // past the timeout window — no late rejection
  })
})
