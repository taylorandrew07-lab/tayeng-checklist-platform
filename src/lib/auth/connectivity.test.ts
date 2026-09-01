import { describe, it, expect } from 'vitest'
import { explainConnectivity, type ConnectivityProbe } from './connectivity'

const probe = (p: Partial<ConnectivityProbe> = {}): ConnectivityProbe => ({
  app: 'ok', auth: 'ok', authStatus: 200, ms: 120, ...p,
})

describe('explainConnectivity', () => {
  it('calls it offline only when BOTH hops fail', () => {
    const v = explainConnectivity(probe({ app: 'failed', auth: 'failed', authStatus: null }))
    expect(v.message).toContain('offline')
    expect(v.offerReset).toBe(false)
  })

  it('names the network as the blocker when the app is reachable but auth is not', () => {
    // This is the case the old copy got wrong: it told a user whose page had
    // plainly loaded to "check your connection".
    const v = explainConnectivity(probe({ auth: 'failed', authStatus: null }))
    expect(v.message).not.toContain('offline')
    expect(v.message).toContain('blocking')
    expect(v.steps[0]).toMatch(/mobile data/i)
    expect(v.steps.some(s => /VPN/i.test(s))).toBe(true)
    expect(v.steps.some(s => /antivirus/i.test(s))).toBe(true)
    // Nothing stored on the device causes a block on the wire, so don't send the
    // user down a reset that cannot help.
    expect(v.offerReset).toBe(false)
  })

  it('offers a device reset when only our own origin is unreachable', () => {
    const v = explainConnectivity(probe({ app: 'failed' }))
    expect(v.offerReset).toBe(true)
  })

  it('treats an intermittent drop as retryable, not as a broken account', () => {
    const v = explainConnectivity(probe())
    expect(v.message).toMatch(/again/i)
    expect(v.offerReset).toBe(true)
  })

  it('always produces a screenshot-able detail line naming both hops', () => {
    const v = explainConnectivity(probe({ auth: 'failed', authStatus: null, ms: 900 }))
    expect(v.detail).toBe('app=ok auth=failed in 900ms')
    expect(explainConnectivity(probe({ authStatus: 401 })).detail).toBe('app=ok auth=ok (401) in 120ms')
  })
})
