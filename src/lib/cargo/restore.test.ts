import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listRestorable, restoreVoyage } from './restore'
import { getVoyage, putVoyage, putPhotos } from './db'

vi.mock('./db', () => ({
  getVoyage: vi.fn(),
  putVoyage: vi.fn(async () => {}),
  putPhotos: vi.fn(async () => {}),
}))

const mockGetVoyage = getVoyage as unknown as ReturnType<typeof vi.fn>
const mockPutVoyage = putVoyage as unknown as ReturnType<typeof vi.fn>
const mockPutPhotos = putPhotos as unknown as ReturnType<typeof vi.fn>

const DOC = {
  id: 'v1', userId: 'someone-else', vesselName: 'Channel Pearl', voyageNumber: 'V-047',
  holdCount: 5, readingTypes: [], readings: {}, periodMeta: {},
  createdAt: 1, updatedAt: 5_000, lastSyncedAt: 4_000,
}

function stub({ row = { id: 'v1', status: 'in_progress', doc: DOC } as any, photos = [] as any[], listRows = [] as any[] } = {}) {
  return {
    from(table: string) {
      const rows = table === 'cargo_voyages' ? listRows : photos
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: table === 'cargo_voyages' ? row : null, error: null }),
            order: async () => ({ data: rows, error: null }),
          }),
        }),
      }
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map(p => ({ path: p, signedUrl: `https://example.test/${p}` })),
        }),
      }),
    },
  } as any
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true })
  globalThis.fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['img']) })) as any
})

describe('listRestorable', () => {
  it('returns only the cloud voyages that are NOT already on this device', async () => {
    const sb = stub({
      listRows: [
        { id: 'v1', vessel_name: 'Channel Pearl', voyage_number: 'V-047', status: 'in_progress', synced_at: '2026-08-10T14:08:15Z', cargo_voyage_photos: [{ count: 12 }] },
        { id: 'v2', vessel_name: 'Other', voyage_number: 'V-002', status: 'finalized', synced_at: '2026-08-01T10:00:00Z', cargo_voyage_photos: [{ count: 0 }] },
      ],
    })
    const out = await listRestorable(sb, 'nary', ['v2'])
    expect(out.map(v => v.id)).toEqual(['v1'])
    expect(out[0].photoCount).toBe(12)
    expect(out[0].vesselName).toBe('Channel Pearl')
  })

  it('is empty when every cloud voyage is already local', async () => {
    const sb = stub({ listRows: [{ id: 'v1', synced_at: 'x', cargo_voyage_photos: [] }] })
    expect(await listRestorable(sb, 'nary', ['v1'])).toEqual([])
  })
})

describe('restoreVoyage', () => {
  it('refuses to overwrite a local copy carrying unsynced work', async () => {
    // updatedAt > lastSyncedAt — voyageDirty(). Pulling the server copy over
    // this would destroy the only copy of those edits.
    mockGetVoyage.mockResolvedValue({ ...DOC, updatedAt: 9_000, lastSyncedAt: 1_000 })
    await expect(restoreVoyage(stub(), 'nary', 'v1')).rejects.toThrow(/have not synced/i)
    expect(mockPutVoyage).not.toHaveBeenCalled()
  })

  it('overwrites a dirty local copy only when explicitly forced', async () => {
    mockGetVoyage.mockResolvedValue({ ...DOC, updatedAt: 9_000, lastSyncedAt: 1_000 })
    await expect(restoreVoyage(stub(), 'nary', 'v1', { force: true })).resolves.toBeTruthy()
    expect(mockPutVoyage).toHaveBeenCalled()
  })

  it('adopts the voyage onto this device and user, and starts it clean', async () => {
    mockGetVoyage.mockResolvedValue(undefined)
    const res = await restoreVoyage(stub(), 'nary', 'v1')
    const saved = mockPutVoyage.mock.calls[0][0]
    expect(saved.userId).toBe('nary')                 // listed for THIS user
    expect(saved.id).toBe('v1')
    // Not immediately "pending" — it matches what the server holds.
    expect(saved.lastSyncedAt).toBe(DOC.updatedAt)
    expect(res.photos).toBe(0)
  })

  it('brings the photos down, marked as already uploaded', async () => {
    mockGetVoyage.mockResolvedValue(undefined)
    const photos = [
      { id: 'p1', storage_path: 'v1/p1.jpg', date_iso: '2026-08-05', period: '0600', hold_number: 1, camera: 'fwd', actual_time: '0605', filename: 'a.jpg', ordinal: 0 },
      { id: 'p2', storage_path: 'v1/p2.jpg', date_iso: '2026-08-05', period: '0600', hold_number: 1, camera: 'aft', actual_time: '0607', filename: 'b.jpg', ordinal: 1 },
    ]
    const res = await restoreVoyage(stub({ photos }), 'nary', 'v1')
    expect(res.photos).toBe(2)
    const saved = mockPutPhotos.mock.calls[0][0]
    // uploaded + storagePath matter: pushVoyage() DELETES any server photo row
    // not present locally, so a restore that forgot these would wipe the
    // server's photos on the very next sync.
    expect(saved.every((p: any) => p.uploaded === true && p.storagePath)).toBe(true)
    expect(saved.every((p: any) => p.userId === 'nary' && p.assigned === true)).toBe(true)
    // Photos are written before the voyage, so it never appears half-restored.
    expect(mockPutPhotos.mock.invocationCallOrder[0]).toBeLessThan(mockPutVoyage.mock.invocationCallOrder[0])
  })

  it('changes nothing on the device if a photo fails to download', async () => {
    mockGetVoyage.mockResolvedValue(undefined)
    globalThis.fetch = vi.fn(async () => ({ ok: false })) as any
    const photos = [{ id: 'p1', storage_path: 'v1/p1.jpg', ordinal: 0 }]
    await expect(restoreVoyage(stub({ photos }), 'nary', 'v1')).rejects.toThrow(/Nothing was changed/)
    expect(mockPutVoyage).not.toHaveBeenCalled()
    expect(mockPutPhotos).not.toHaveBeenCalled()
  })

  it('refuses to run offline instead of half-restoring', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true, writable: true })
    await expect(restoreVoyage(stub(), 'nary', 'v1')).rejects.toThrow(/offline/i)
    expect(mockPutVoyage).not.toHaveBeenCalled()
  })
})

describe('restoreVoyage ownership', () => {
  it('refuses a voyage owned by another surveyor', async () => {
    // The listing only ever offers your own, but the function must not rely on
    // that: a restore rewrites doc.userId and pushVoyage then writes owner_id
    // from it, silently reassigning the voyage and breaking the real owner's
    // sync — an error syncAllCargo swallows, so their device looks fine.
    mockGetVoyage.mockResolvedValue(undefined)
    const sb = stub({ row: { id: 'v1', status: 'in_progress', doc: DOC, owner_id: 'someone-else' } })
    await expect(restoreVoyage(sb, 'nary', 'v1')).rejects.toThrow(/another surveyor/i)
    expect(mockPutVoyage).not.toHaveBeenCalled()
  })

  it('allows a voyage that is genuinely yours', async () => {
    mockGetVoyage.mockResolvedValue(undefined)
    const sb = stub({ row: { id: 'v1', status: 'in_progress', doc: DOC, owner_id: 'nary' } })
    await expect(restoreVoyage(sb, 'nary', 'v1')).resolves.toBeTruthy()
  })
})
