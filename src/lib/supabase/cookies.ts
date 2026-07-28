// Single source of truth for "does this cookie name represent a real session?".
//
// Supabase writes several cookies whose names all begin `sb-<project-ref>-auth-token`:
//   sb-<ref>-auth-token                 ← the session (may be chunked: .0, .1, …)
//   sb-<ref>-auth-token-code-verifier   ← PKCE verifier, written the moment a user
//                                         requests a password reset / OAuth start
//
// The verifier is NOT a session. A naive `startsWith('sb-') && includes('-auth-token')`
// test matches it, which meant that merely clicking "Forgot password?" made a
// signed-out user look authenticated: the route guard let them through and the page
// then rendered with no session behind it (blank screen / redirect loop).
//
// Both the browser (src/lib/supabase/client.ts) and the middleware (src/proxy.ts)
// must apply the SAME test, so it lives here.
export function isAuthSessionCookie(name: string): boolean {
  if (!name.startsWith('sb-')) return false
  if (!name.includes('-auth-token')) return false
  // Exclude the PKCE verifier and any other non-session sidecar cookie that shares
  // the `-auth-token` prefix.
  if (name.includes('-code-verifier') || name.includes('-verifier')) return false
  return true
}
