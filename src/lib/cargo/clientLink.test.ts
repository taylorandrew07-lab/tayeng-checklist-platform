import { describe, it, expect } from 'vitest'
import { resolveClientLink } from './clientLink'

const OPTIONS = [
  { id: 'c1', name: 'Nu-Iron Unlimited' },
  { id: 'c2', name: 'Yara Trinidad' },
]

describe('resolveClientLink — dropdown mode', () => {
  it('stores the selected id and a snapshot of its name', () => {
    expect(resolveClientLink({ options: OPTIONS, clientId: 'c1', clientName: '', stored: null }))
      .toEqual({ clientId: 'c1', clientName: 'Nu-Iron Unlimited' })
  })

  it('keeps a stored text-mode name the dropdown cannot show', () => {
    // The offline-created voyage, now opened online: clientId is '' because the
    // name was never a real link, and it must survive an unrelated Setup edit.
    expect(resolveClientLink({
      options: OPTIONS, clientId: '', clientName: '',
      stored: { clientId: null, clientName: 'Point Lisas Terminal' },
    })).toEqual({ clientId: null, clientName: 'Point Lisas Terminal' })
  })
})

describe('resolveClientLink — text mode (empty pick list)', () => {
  const stored = { clientId: 'c1', clientName: 'Nu-Iron Unlimited' }

  it('does NOT wipe the stored link when the name is untouched', () => {
    // The Channel Pearl regression: an offline Setup edit used to null clientId,
    // dropping the clients FK and the row's colour in the jobs register.
    expect(resolveClientLink({
      options: [], clientId: '', clientName: 'Nu-Iron Unlimited', stored,
    })).toEqual({ clientId: 'c1', clientName: 'Nu-Iron Unlimited' })
  })

  it('ignores surrounding whitespace when comparing the name', () => {
    expect(resolveClientLink({
      options: [], clientId: '', clientName: '  Nu-Iron Unlimited  ', stored,
    }).clientId).toBe('c1')
  })

  it('drops the link once the typed name names a different client', () => {
    expect(resolveClientLink({
      options: [], clientId: '', clientName: 'Yara Trinidad', stored,
    })).toEqual({ clientId: null, clientName: 'Yara Trinidad' })
  })

  it('keeps the stored name rather than clearing it on an empty box', () => {
    expect(resolveClientLink({ options: [], clientId: '', clientName: '', stored }))
      .toEqual({ clientId: null, clientName: 'Nu-Iron Unlimited' })
  })

  it('creates with no link at all', () => {
    expect(resolveClientLink({ options: [], clientId: '', clientName: 'Walk-in', stored: null }))
      .toEqual({ clientId: null, clientName: 'Walk-in' })
    expect(resolveClientLink({ options: [], clientId: '', clientName: '', stored: null }))
      .toEqual({ clientId: null, clientName: undefined })
  })
})
