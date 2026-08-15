// The device predicates decide which delivery channel every file in the app takes,
// and they are the one part of lib/pdf/deliver.ts that is pure logic — so they are
// the one part that can be pinned down without a real phone.
//
// The case that matters most: iOS running as an installed Home-Screen app. There,
// downloads cannot work at all and only the share sheet can get a file out, so
// isIosStandalone() must be true for exactly that and nothing else. An installed
// Android or desktop PWA also matches `display-mode: standalone` and must NOT be
// caught by it — those download perfectly well.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { isMobileDevice, isIosStandalone, canShareFile, assertOnline, CSV_MIME } from './deliver'

type Device = {
  ua: string
  uaData?: { mobile?: boolean; platform?: string }
  maxTouchPoints?: number
  /** iOS's legacy navigator.standalone flag. */
  standalone?: boolean
  /** Whether `(display-mode: standalone)` matches. */
  displayMode?: boolean
  onLine?: boolean
}

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
}

function mock(d: Device) {
  vi.stubGlobal('navigator', {
    userAgent: d.ua,
    userAgentData: d.uaData,
    maxTouchPoints: d.maxTouchPoints ?? 0,
    standalone: d.standalone,
    onLine: d.onLine ?? true,
  })
  vi.stubGlobal('window', {
    matchMedia: (q: string) => ({ matches: q.includes('standalone') ? !!d.displayMode : false }),
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('isMobileDevice', () => {
  it('is true for an iPhone', () => {
    mock({ ua: UA.iphoneSafari })
    expect(isMobileDevice()).toBe(true)
  })

  it('is true for iPadOS, which reports itself as a Macintosh', () => {
    mock({ ua: UA.ipadOS, maxTouchPoints: 5 })
    expect(isMobileDevice()).toBe(true)
  })

  it('is true for an Android phone', () => {
    mock({ ua: UA.androidPhone, uaData: { mobile: true, platform: 'Android' } })
    expect(isMobileDevice()).toBe(true)
  })

  // The regression: Android tablets report mobile:false, and the /Android/ UA fallback
  // was unreachable behind the typeof check — so tablets took the desktop path.
  it('is true for an Android tablet despite userAgentData.mobile === false', () => {
    mock({ ua: UA.androidTablet, uaData: { mobile: false, platform: 'Android' } })
    expect(isMobileDevice()).toBe(true)
  })

  it('is true for an Android phone in "Request desktop site"', () => {
    mock({ ua: UA.windowsChrome, uaData: { mobile: false, platform: 'Android' } })
    expect(isMobileDevice()).toBe(true)
  })

  it('is false for Windows Chrome', () => {
    mock({ ua: UA.windowsChrome, uaData: { mobile: false, platform: 'Windows' } })
    expect(isMobileDevice()).toBe(false)
  })

  it('is false for desktop Safari with no touch points', () => {
    mock({ ua: UA.macSafari, maxTouchPoints: 0 })
    expect(isMobileDevice()).toBe(false)
  })

  it('is false for a touchscreen Windows laptop', () => {
    mock({ ua: UA.windowsChrome, uaData: { mobile: false, platform: 'Windows' }, maxTouchPoints: 10 })
    expect(isMobileDevice()).toBe(false)
  })
})

describe('isIosStandalone', () => {
  it('is true for an iPhone launched from the Home Screen (legacy flag)', () => {
    mock({ ua: UA.iphoneSafari, standalone: true })
    expect(isIosStandalone()).toBe(true)
  })

  it('is true for an iPhone matching display-mode: standalone', () => {
    mock({ ua: UA.iphoneSafari, displayMode: true })
    expect(isIosStandalone()).toBe(true)
  })

  it('is false for an iPhone in a normal Safari tab', () => {
    mock({ ua: UA.iphoneSafari })
    expect(isIosStandalone()).toBe(false)
  })

  // The AND with the iOS test is load-bearing: these two install as PWAs and match
  // display-mode: standalone, but they have real downloads and must not be told to
  // use the share sheet instead.
  it('is false for an installed Android PWA', () => {
    mock({ ua: UA.androidPhone, uaData: { mobile: true, platform: 'Android' }, displayMode: true })
    expect(isIosStandalone()).toBe(false)
  })

  it('is false for an installed desktop PWA', () => {
    mock({ ua: UA.windowsChrome, uaData: { mobile: false, platform: 'Windows' }, displayMode: true })
    expect(isIosStandalone()).toBe(false)
  })

  it('is true for an installed iPadOS app reporting as Macintosh', () => {
    mock({ ua: UA.ipadOS, maxTouchPoints: 5, displayMode: true })
    expect(isIosStandalone()).toBe(true)
  })
})

describe('canShareFile', () => {
  const file = new File(['a,b'], 'x.csv', { type: CSV_MIME })

  it('is false when the browser has no Web Share API at all', () => {
    mock({ ua: UA.windowsChrome })
    expect(canShareFile(file)).toBe(false)
  })

  it('is false when the browser refuses this file type', () => {
    mock({ ua: UA.iphoneSafari })
    Object.assign(navigator, { share: () => {}, canShare: () => false })
    expect(canShareFile(file)).toBe(false)
  })

  it('is true when the browser accepts the file', () => {
    mock({ ua: UA.iphoneSafari })
    Object.assign(navigator, { share: () => {}, canShare: () => true })
    expect(canShareFile(file)).toBe(true)
  })
})

describe('assertOnline', () => {
  it('throws a message naming the server when the device is offline', () => {
    mock({ ua: UA.iphoneSafari, onLine: false })
    expect(() => assertOnline()).toThrow(/offline/i)
  })

  it('does nothing when online', () => {
    mock({ ua: UA.iphoneSafari, onLine: true })
    expect(() => assertOnline()).not.toThrow()
  })
})
