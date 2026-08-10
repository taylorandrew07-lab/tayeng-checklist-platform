// public/sw.js is plain JS that nothing else typechecks or exercises, and the
// offline app shell now depends on one regex in it. Pull that function out of
// the real file and test it, so a future edit to the routing can't silently
// serve the voyage workspace in place of "New voyage" — or stop serving it at all.
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const SW = fs.readFileSync(path.resolve(__dirname, '../../../public/sw.js'), 'utf8')

function extract(name: string): (...args: any[]) => any {
  const start = SW.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`${name}() is missing from public/sw.js`)
  // Walk the braces so the whole body comes out regardless of formatting.
  let depth = 0, i = SW.indexOf('{', start)
  const open = i
  for (; i < SW.length; i++) {
    if (SW[i] === '{') depth++
    else if (SW[i] === '}') { depth--; if (depth === 0) break }
  }
  const src = SW.slice(start, i + 1)
  const consts = /const SHELL_KEY = '([^']+)'/.exec(SW)
  return new Function(`const SHELL_KEY = ${JSON.stringify(consts?.[1] ?? '')}; ${src}; return ${name}`)()
}

const shellKeyFor = extract('shellKeyFor')

describe('service worker: offline cargo shell', () => {
  it('serves the shell for any voyage page', () => {
    expect(shellKeyFor('/surveyor/cargo/voyage_c00eb38b')).toBeTruthy()
    expect(shellKeyFor('/surveyor/cargo/voyage_abc/')).toBeTruthy()
    // Every voyage resolves to the SAME key — one cached document covers them all.
    expect(shellKeyFor('/surveyor/cargo/a')).toBe(shellKeyFor('/surveyor/cargo/b'))
  })

  it('never stands in for a sibling route that has its own page', () => {
    expect(shellKeyFor('/surveyor/cargo/new')).toBeNull()
    expect(shellKeyFor('/surveyor/cargo')).toBeNull()
  })

  it('does not apply outside the surveyor cargo routes', () => {
    // Admin is an online surface; the shell is for the offline one only.
    expect(shellKeyFor('/admin/cargo/voyage_x')).toBeNull()
    expect(shellKeyFor('/surveyor/jobs/abc')).toBeNull()
    expect(shellKeyFor('/surveyor/cargo/voyage_x/extra')).toBeNull()
  })

  it('keeps the priming URL and the cache key distinct', () => {
    // If SHELL_URL were used as the key, the shell would be evicted the moment a
    // real navigation to that path was cached over it.
    const url = /const SHELL_URL = '([^']+)'/.exec(SW)?.[1]
    const key = /const SHELL_KEY = '([^']+)'/.exec(SW)?.[1]
    expect(url).toBeTruthy()
    expect(key).toBeTruthy()
    expect(url).not.toBe(key)
  })

  it('refuses to cache a redirect as the shell', () => {
    // A signed-out prime request redirects to /login. Caching that would show an
    // offline surveyor a login form for every voyage, forever.
    expect(SW).toMatch(/res\.redirected/)
  })

  it('bumps the cache version when the shell behaviour changes', () => {
    const v = /const VERSION = '(v\d+)'/.exec(SW)?.[1]
    expect(v).toBeTruthy()
    expect(Number(v!.slice(1))).toBeGreaterThanOrEqual(8)
  })
})
