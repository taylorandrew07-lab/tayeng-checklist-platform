// Why this exists
// ---------------
// "Could not reach the server. Check your connection and try again." is true but
// useless: it sends a user to check a wifi connection that is demonstrably working,
// because the login PAGE loaded. The failure it actually describes is narrower — the
// browser's fetch to https://<ref>.supabase.co/auth/v1/token was REJECTED, fast (a
// stall would have hit withTimeout and shown the timeout message instead).
//
// A fast rejection with the app itself reachable means something between the device
// and Supabase specifically: router/ISP DNS filtering, a VPN, or antivirus HTTPS
// scanning. Telling the user "check your connection" makes that state unfixable by
// the person sitting in front of it, so we probe the two hops separately and say
// which one broke.

export type ConnectivityHop = 'ok' | 'failed'

export type ConnectivityProbe = {
  app: ConnectivityHop
  auth: ConnectivityHop
  authStatus: number | null
  ms: number
}

export type ConnectivityVerdict = {
  /** Headline shown in the error box. */
  message: string
  /** Ordered, concrete things this user can do right now. Empty = nothing useful. */
  steps: string[]
  /** True when wiping the SW/caches on this device is a plausible fix. */
  offerReset: boolean
  /** One-line summary safe to screenshot and send to an admin. */
  detail: string
}

const APP_PROBE = '/api/health'

/** Fetch with a hard deadline; resolves to null on any failure. */
async function probe(url: string, ms: number, headers?: Record<string, string>): Promise<Response | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fetch(url, { method: 'GET', cache: 'no-store', signal: ctl.signal, headers })
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

/**
 * Probe our own origin and the Supabase auth service independently.
 *
 * The auth probe hits /auth/v1/health, which is unauthenticated and needs no apikey,
 * so it isolates *reachability* from anything to do with credentials. It is a plain
 * CORS GET to the same host the sign-in POST uses, so a DNS block, a TLS-inspecting
 * proxy or a CSP violation fails it in exactly the same way.
 */
export async function probeConnectivity(
  supabaseUrl: string | undefined,
  anonKey?: string,
): Promise<ConnectivityProbe> {
  const started = Date.now()
  // Sending the apikey header is deliberate, for two reasons. It makes the request
  // non-simple, so the browser issues a CORS preflight — exactly like the real
  // sign-in POST, which sets Content-Type: application/json. A proxy that kills
  // preflights therefore fails this probe the same way it fails the real request,
  // instead of quietly passing and telling the user everything is fine. It also gets
  // a clean 200 rather than a 401, which reads better in the detail line.
  // The key is NEXT_PUBLIC_ and already inlined in this bundle — nothing is exposed
  // here that the page did not already ship to every visitor.
  const authHeaders = anonKey ? { apikey: anonKey } : undefined
  const [app, auth] = await Promise.all([
    probe(APP_PROBE, 8000),
    supabaseUrl ? probe(`${supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`, 8000, authHeaders) : Promise.resolve(null),
  ])
  return {
    app: app?.ok ? 'ok' : 'failed',
    // Any HTTP answer at all — even a 4xx — proves the host was REACHED, which is the
    // only thing this probe is measuring. Treating a non-2xx as "unreachable" would
    // re-introduce the very misdiagnosis this module exists to prevent.
    auth: auth ? 'ok' : 'failed',
    authStatus: auth ? auth.status : null,
    ms: Date.now() - started,
  }
}

/** Turn a probe into words the person holding the phone can act on. */
export function explainConnectivity(p: ConnectivityProbe): ConnectivityVerdict {
  const detail = `app=${p.app} auth=${p.auth}${p.authStatus !== null ? ` (${p.authStatus})` : ''} in ${p.ms}ms`

  if (p.app === 'failed' && p.auth === 'failed') {
    return {
      message: 'This device is offline right now — nothing on the internet is reachable.',
      steps: [
        'Check wifi or mobile data is actually on and connected.',
        'If you are on wifi, try turning wifi off so the phone uses mobile data, then sign in again.',
      ],
      offerReset: false,
      detail,
    }
  }

  if (p.app === 'ok' && p.auth === 'failed') {
    return {
      message:
        'This device can reach the Taylor Engineering app, but something on your network is blocking the sign-in service.',
      steps: [
        'Turn wifi OFF and use mobile data, then sign in again. If that works, the problem is your wifi router or your internet provider.',
        'If you use a VPN, turn it off and try again.',
        'On a laptop: turn off the web/HTTPS scanning in your antivirus (Kaspersky, ESET, Avast, Bitdefender and Norton all block sites this way) and try again.',
      ],
      // Nothing stored on the device can cause this — the block is on the wire.
      offerReset: false,
      detail,
    }
  }

  if (p.app === 'failed' && p.auth === 'ok') {
    return {
      message:
        'The sign-in service is reachable but this device could not reach the app itself. This is usually a stale copy of the app stored on this device.',
      steps: ['Tap "Reset the app on this device" below, then sign in again.'],
      offerReset: true,
      detail,
    }
  }

  // Both hops answer now, yet the sign-in POST failed a moment ago. Genuinely
  // intermittent — which is the normal state dockside — or a stale service worker
  // holding an old build.
  return {
    message:
      'The connection dropped mid sign-in but looks fine now. Tap Sign in again.',
    steps: [
      'Tap Sign in once more.',
      'If it keeps failing, tap "Reset the app on this device" below and try again.',
    ],
    offerReset: true,
    detail,
  }
}
