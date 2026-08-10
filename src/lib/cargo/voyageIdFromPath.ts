// Which voyage a cargo URL points at.
//
// Extracted so the rule is testable: offline, the service worker may serve a
// cached app shell whose embedded route tree names a DIFFERENT voyage, so
// useParams() cannot be trusted on these pages. The path in the address bar can.

/** The voyage id in a /surveyor/cargo/<id> or /admin/cargo/<id> path, or null. */
export function voyageIdFromPath(pathname: string): string | null {
  const m = /\/cargo\/([^/?#]+)/.exec(pathname)
  if (!m?.[1]) return null
  const id = decodeURIComponent(m[1])
  // Sibling static routes under /cargo — none of them is a voyage.
  if (id === 'new' || id === 'register' || id === 'cloud' || id === '__shell__') return null
  return id
}
